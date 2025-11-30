const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pro parsování JSON
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server běží',
    message: 'Netflix automation service je aktivní',
    endpoints: {
      confirm: 'POST /netflix-confirm'
    }
  });
});

// Hlavní endpoint pro potvrzení Netflix domácnosti
app.post('/netflix-confirm', async (req, res) => {
  const { url, fullScreenshots } = req.body;

  // Validace URL
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
  try {
    // Optimalizované argumenty pro rychlejší start
    console.log('🚀 Spouštím Puppeteer (optimalizovaný)...');
    
    const args = [
      ...chromium.args,
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Rychlejší start
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ];
    
    browser = await puppeteer.launch({
      args: args,
      defaultViewport: { width: 1366, height: 768 }, // Menší = rychlejší
      executablePath: await chromium.executablePath(),
      headless: 'new', // Nový headless mode je rychlejší
    });

    const page = await browser.newPage();
    console.log(`⏱️ Browser start: ${Date.now() - startTime}ms`);

    // Stealth konfigurace - maskování že je to bot
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['cs-CZ', 'cs', 'en-US', 'en']
      });
    });

    // User agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Minimální headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'cs-CZ,cs;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    console.log('🌐 Otevírám Netflix URL...');
    
    // RYCHLEJŠÍ načtení - čekáme jen na DOM, ne na všechny zdroje
    await page.goto(url, {
      waitUntil: 'domcontentloaded', // Místo 'networkidle2'
      timeout: 30000
    });
    console.log(`⏱️ Page load: ${Date.now() - startTime}ms`);
    
    // Kratší čekání - jen 500ms místo 2s
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('🔍 Hledám potvrzovací tlačítko...');

    // Možné selektory
    const possibleSelectors = [
      'button[data-uia="confirmation-button"]',
      'button[data-uia="confirm-button"]',
      'button[data-uia="btn-continue"]',
      'button[type="submit"]',
      'button.btn-confirm',
      'a[data-uia="confirmation-link"]',
      '.primary-button',
      'button.nfBtn-primary',
      'button.btn-primary'
    ];

    let buttonFound = false;
    let usedSelector = null;

    // Zkrácené timeouty - 2s místo 5s
    for (const selector of possibleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        buttonFound = true;
        usedSelector = selector;
        console.log(`✅ Tlačítko nalezeno: ${selector}`);
        break;
      } catch (e) {
        // Pokračuj dál
      }
    }

    if (!buttonFound) {
      console.log('🔍 Hledám podle textu...');
      try {
        const textButton = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          return buttons.find(btn => 
            btn.textContent.toLowerCase().includes('potvrdit') || 
            btn.textContent.toLowerCase().includes('confirm') ||
            btn.textContent.toLowerCase().includes('aktualizovat') ||
            btn.textContent.toLowerCase().includes('update')
          );
        });
        
        if (textButton) {
          buttonFound = true;
          usedSelector = 'text-based-search';
          console.log('✅ Tlačítko nalezeno podle textu');
        }
      } catch (e) {
        console.log('❌ Tlačítko nenalezeno');
      }
    }

    if (!buttonFound) {
      // Screenshot jen pro debug (viewport only = rychlejší)
      const debugScreenshot = await page.screenshot({ 
        encoding: 'base64',
        fullPage: false // Rychlejší
      });
      
      await browser.close();
      
      return res.status(500).json({
        success: false,
        error: 'Potvrzovací tlačítko nebylo nalezeno',
        screenshot: `data:image/png;base64,${debugScreenshot}`
      });
    }

    console.log(`⏱️ Button found: ${Date.now() - startTime}ms`);

    // Screenshots - volitelné, jen pokud požadováno
    let screenshotBefore = null;
    if (fullScreenshots) {
      console.log('📸 Screenshot před kliknutím...');
      screenshotBefore = await page.screenshot({ 
        encoding: 'base64',
        fullPage: true 
      });
    }

    // Kliknutí
    console.log('👆 Klikám...');
    
    if (usedSelector === 'text-based-search') {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const confirmButton = buttons.find(btn => 
          btn.textContent.toLowerCase().includes('potvrdit') || 
          btn.textContent.toLowerCase().includes('confirm') ||
          btn.textContent.toLowerCase().includes('aktualizovat') ||
          btn.textContent.toLowerCase().includes('update')
        );
        if (confirmButton) confirmButton.click();
      });
    } else {
      await page.click(usedSelector);
    }

    console.log(`⏱️ Click done: ${Date.now() - startTime}ms`);

    // RYCHLEJŠÍ čekání - jen 1.5s místo 3s
    console.log('⏳ Čekám na dokončení...');
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }),
        new Promise(resolve => setTimeout(resolve, 1500))
      ]);
    } catch (e) {
      // Timeout OK
    }

    // Screenshot po kliknutí - volitelný
    let screenshotAfter = null;
    if (fullScreenshots) {
      console.log('📸 Screenshot po kliknutí...');
      screenshotAfter = await page.screenshot({ 
        encoding: 'base64',
        fullPage: true 
      });
    }

    const finalUrl = page.url();
    const wasRedirectedToLogin = finalUrl.includes('/login');

    await browser.close();

    const totalTime = Date.now() - startTime;
    console.log(`✅ Dokončeno za ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);

    const response = {
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
        timestamp: new Date().toISOString()
      }
    };

    // Přidat screenshots jen pokud byly pořízeny
    if (fullScreenshots && (screenshotBefore || screenshotAfter)) {
      response.screenshots = {
        before: screenshotBefore ? `data:image/png;base64,${screenshotBefore}` : null,
        after: screenshotAfter ? `data:image/png;base64,${screenshotAfter}` : null
      };
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Chyba:', error.message);
    
    if (browser) {
      await browser.close();
    }

    res.status(500).json({
      success: false,
      error: error.message,
      executionTimeMs: Date.now() - startTime
    });
  }
});

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`🚀 Server běží na portu ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Server se vypína...');
  process.exit(0);
});
