const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    status: 'Server běží',
    message: 'Netflix automation service - OPTIMIZED verze',
    endpoints: {
      confirm: 'POST /netflix-confirm'
    }
  });
});

app.post('/netflix-confirm', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ 
      success: false, 
      error: 'URL je povinný parametr' 
    });
  }

  if (!url.includes('netflix.com')) {
    return res.status(400).json({ 
      success: false, 
      error: 'URL musí být z domény netflix.com' 
    });
  }

  console.log(`📥 Přijat požadavek pro URL: ${url}`);
  const startTime = Date.now();

  let browser;
  let page;
  
  try {
    console.log('🚀 Spouštím browser...');
    
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
      defaultViewport: { width: 1366, height: 768 },
      executablePath: await chromium.executablePath(),
      headless: 'new',
    });

    page = await browser.newPage();
    console.log(`⏱️ Browser start: ${Date.now() - startTime}ms`);

    // Stealth konfigurace
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['cs-CZ', 'cs', 'en-US', 'en'] });
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('🌐 Otevírám Netflix URL...');
    
    // Rychlé načtení - jen DOM
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log(`⏱️ Page load: ${Date.now() - startTime}ms`);
    console.log('🔍 Hledám tlačítko...');

    // DŮLEŽITÉ: Čekáme na tlačítko pomocí Puppeteer (ne jen DOM check)
    // Tím zajistíme že je tlačítko opravdu klikatelné
    const possibleSelectors = [
      'button[type="button"]',
      'button[type="submit"]',
      'button[data-uia="set-primary-location-action"]',
      'button[data-uia="confirmation-button"]',
      'button[data-uia="confirm-button"]'
    ];

    let buttonFound = false;
    let usedSelector = null;

    // Rychlé paralelní hledání - KRATŠÍ timeout (3s místo 8s)
    try {
      const selectorPromises = possibleSelectors.map(selector => 
        page.waitForSelector(selector, { timeout: 3000 })
          .then(() => ({ success: true, selector }))
          .catch(() => ({ success: false, selector }))
      );

      const results = await Promise.all(selectorPromises);
      const found = results.find(r => r.success);
      
      if (found) {
        buttonFound = true;
        usedSelector = found.selector;
        console.log(`✅ Tlačítko nalezeno: ${usedSelector}`);
      }
    } catch (e) {
      console.log('❌ Chyba při hledání tlačítka');
    }

    // Fallback - text search
    if (!buttonFound) {
      console.log('🔍 Hledám podle textu...');
      try {
        const hasButton = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          return buttons.some(btn => 
            btn.textContent.toLowerCase().includes('potvrdit') || 
            btn.textContent.toLowerCase().includes('aktualizovat') ||
            btn.textContent.toLowerCase().includes('confirm')
          );
        });
        
        if (hasButton) {
          buttonFound = true;
          usedSelector = 'text-based';
          console.log('✅ Tlačítko nalezeno podle textu');
        }
      } catch (e) {
        console.log('❌ Tlačítko nenalezeno');
      }
    }

    console.log(`⏱️ Button search: ${Date.now() - startTime}ms`);

    if (!buttonFound) {
      const screenshot = await page.screenshot({ 
        encoding: 'base64',
        fullPage: false
      });
      
      await browser.close();
      
      return res.status(500).json({
        success: false,
        error: 'Potvrzovací tlačítko nebylo nalezeno',
        screenshot: `data:image/png;base64,${screenshot}`,
        executionTimeMs: Date.now() - startTime
      });
    }

    // KRITICKÉ: Použít Puppeteer.click() místo DOM click
    console.log('👆 Klikám pomocí Puppeteer...');
    
    if (usedSelector === 'text-based') {
      // Pro text-based musíme použít evaluate
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const confirmButton = buttons.find(btn => 
          btn.textContent.toLowerCase().includes('potvrdit') || 
          btn.textContent.toLowerCase().includes('aktualizovat') ||
          btn.textContent.toLowerCase().includes('confirm')
        );
        if (confirmButton) confirmButton.click();
      });
    } else {
      // Pro selector používáme PUPPETEER CLICK (spolehlivější!)
      await page.click(usedSelector);
    }

    console.log(`⏱️ Click done: ${Date.now() - startTime}ms`);

    // Počkáme na dokončení API requestu - PRODLOUŽENO na 2s
    console.log('⏳ Čekám na dokončení...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const finalUrl = page.url();
    const wasRedirectedToLogin = finalUrl.includes('/login');

    await browser.close();

    const totalTime = Date.now() - startTime;
    console.log(`✅ Dokončeno za ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);

    res.json({
      success: !wasRedirectedToLogin,
      message: wasRedirectedToLogin 
        ? '⚠️ Netflix vyžaduje přihlášení'
        : '✅ Netflix domácnost byla úspěšně potvrzena',
      details: {
        originalUrl: url,
        finalUrl: finalUrl,
        buttonSelector: usedSelector,
        redirectedToLogin: wasRedirectedToLogin,
        executionTimeMs: totalTime,
        executionTimeSec: (totalTime/1000).toFixed(1),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Chyba:', error.message);
    
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }

    res.status(500).json({
      success: false,
      error: error.message,
      executionTimeMs: Date.now() - startTime
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server běží na portu ${PORT}`);
  console.log(`⚡ OPTIMIZED mode - rychlý A spolehlivý`);
});

process.on('SIGTERM', () => {
  console.log('👋 Server se vypína...');
  process.exit(0);
});
