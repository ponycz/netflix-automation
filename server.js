const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    status: 'Server běží',
    message: 'Netflix automation service - ULTRA FAST verze',
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

    // Minimální stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('🌐 Navigace na URL...');
    
    // KRITICKÁ OPTIMALIZACE: domcontentloaded místo networkidle
    // a okamžitě hledáme tlačítko jakmile DOM je ready
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log(`⏱️ Page loaded: ${Date.now() - startTime}ms`);
    console.log('🔍 Hledám a klikám na tlačítko...');

    // OKAMŽITĚ hledáme a klikáme - bez dalších čekání!
    const clicked = await page.evaluate(() => {
      // Hledáme tlačítko - víme že je button[type="button"]
      const selectors = [
        'button[type="button"]',
        'button[type="submit"]',
        'button[data-uia="set-primary-location-action"]'
      ];
      
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button) {
          button.click();
          return { success: true, selector: selector };
        }
      }
      
      // Fallback - text search
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const confirmButton = buttons.find(btn => 
        btn.textContent.toLowerCase().includes('potvrdit') || 
        btn.textContent.toLowerCase().includes('aktualizovat')
      );
      
      if (confirmButton) {
        confirmButton.click();
        return { success: true, selector: 'text-based' };
      }
      
      return { success: false };
    });

    if (!clicked.success) {
      console.log('❌ Tlačítko nenalezeno');
      
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

    console.log(`✅ Kliknuto pomocí: ${clicked.selector}`);
    console.log(`⏱️ Click done: ${Date.now() - startTime}ms`);

    // Velmi krátké čekání na API request
    await new Promise(resolve => setTimeout(resolve, 800));

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
        buttonSelector: clicked.selector,
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
  console.log(`⚡ ULTRA FAST mode aktivní`);
});

process.on('SIGTERM', () => {
  console.log('👋 Server se vypína...');
  process.exit(0);
});
