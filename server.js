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
  const { url } = req.body;

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

  let browser;
  try {
    // Spuštění prohlížeče s optimalizovaným Chromiem a stealth argumenty
    console.log('🚀 Spouštím Puppeteer ve stealth módu...');
    
    const args = [
      ...chromium.args,
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security'
    ];
    
    browser = await puppeteer.launch({
      args: args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // Stealth konfigurace - maskování že je to bot
    await page.evaluateOnNewDocument(() => {
      // Přepsat webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Přidat chrome property
      window.chrome = {
        runtime: {}
      };
      
      // Maskovat permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Přepsat plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Přepsat languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['cs-CZ', 'cs', 'en-US', 'en']
      });
    });

    // Realistický user agent (ne headless)
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Extra headers pro realističnost
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'cs-CZ,cs;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    console.log('🌐 Otevírám Netflix URL...');
    
    // Otevření stránky s realistickým chováním
    await page.goto(url, {
      waitUntil: 'networkidle0', // Počkat až se všechno načte
      timeout: 15000
    });
    
    // Počkat chvíli jako by uživatel četl stránku
    console.log('⏳ Čekám 2 sekundy (simulace čtení stránky)...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('🔍 Hledám potvrzovací tlačítko...');

    // Možné selektory pro potvrzovací tlačítko
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
    let buttonElement = null;

    // Zkusíme najít tlačítko pomocí různých selektorů
    for (const selector of possibleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        buttonFound = true;
        usedSelector = selector;
        buttonElement = await page.$(selector);
        console.log(`✅ Tlačítko nalezeno pomocí: ${selector}`);
        break;
      } catch (e) {
        console.log(`❌ Selektor ${selector} nenalezen, zkouším další...`);
      }
    }

    if (!buttonFound) {
      // Pokud nenajdeme tlačítko pomocí selektorů, zkusíme podle textu
      console.log('🔍 Hledám tlačítko podle textu...');
      try {
        buttonElement = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          return buttons.find(btn => 
            btn.textContent.toLowerCase().includes('potvrdit') || 
            btn.textContent.toLowerCase().includes('confirm') ||
            btn.textContent.toLowerCase().includes('aktualizovat') ||
            btn.textContent.toLowerCase().includes('update')
          );
        });
        
        if (buttonElement) {
          buttonFound = true;
          usedSelector = 'text-based-search';
          console.log('✅ Tlačítko nalezeno podle textu');
        }
      } catch (e) {
        console.log('❌ Tlačítko nenalezeno ani podle textu');
      }
    }

    if (!buttonFound) {
      // Screenshot pro debugging
      const debugScreenshot = await page.screenshot({ 
        encoding: 'base64',
        fullPage: true 
      });
      
      throw new Error('Potvrzovací tlačítko nebylo nalezeno na stránce. Screenshot byl pořízen pro debugging.');
    }

    // Screenshot před kliknutím
    console.log('📸 Pořizuji screenshot před kliknutím...');
    const screenshotBefore = await page.screenshot({ 
      encoding: 'base64',
      fullPage: true 
    });

    // Realistické kliknutí - simulace pohybu myši k tlačítku
    console.log('🖱️ Simuluji pohyb myši k tlačítku...');
    
    if (usedSelector !== 'text-based-search') {
      const button = await page.$(usedSelector);
      const box = await button.boundingBox();
      
      if (box) {
        // Pohyb myši k tlačítku
        await page.mouse.move(
          box.x + box.width / 2, 
          box.y + box.height / 2,
          { steps: 10 } // Plynulý pohyb
        );
        
        // Malé čekání před kliknutím
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Kliknutí na tlačítko
    console.log('👆 Klikám na tlačítko...');
    
    if (usedSelector === 'text-based-search') {
      // Kliknutí pomocí evaluate
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
      // Normální kliknutí
      await page.click(usedSelector);
    }

    // Počkáme na navigaci nebo změnu stránky
    console.log('⏳ Čekám na dokončení (5 sekund)...');
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);
    } catch (e) {
      // Timeout je OK, stránka se třeba nenavigovala
      console.log('ℹ️ Žádná navigace, pokračuji...');
    }

    // Screenshot po kliknutí
    console.log('📸 Pořizuji screenshot po kliknutí...');
    const screenshotAfter = await page.screenshot({ 
      encoding: 'base64',
      fullPage: true 
    });

    // Získání finální URL
    const finalUrl = page.url();
    console.log(`📍 Finální URL: ${finalUrl}`);

    // Kontrola jestli jsme přesměrováni na login
    const wasRedirectedToLogin = finalUrl.includes('/login');
    
    // Kontrola jestli URL zůstala stejná (možná chyba)
    const urlUnchanged = finalUrl === url;

    await browser.close();

    console.log('✅ Úspěšně dokončeno!');

    // Určení úspěchu
    const success = !wasRedirectedToLogin && !urlUnchanged;

    res.json({
      success: success,
      message: wasRedirectedToLogin 
        ? '⚠️ Netflix vyžaduje přihlášení - URL může být již použitá nebo expirovaná'
        : urlUnchanged
        ? '⚠️ URL se nezměnila - tlačítko možná nefungovalo nebo je potřeba autentizace'
        : '✅ Netflix domácnost byla úspěšně potvrzena',
      details: {
        originalUrl: url,
        finalUrl: finalUrl,
        buttonSelector: usedSelector,
        redirectedToLogin: wasRedirectedToLogin,
        urlUnchanged: urlUnchanged,
        timestamp: new Date().toISOString()
      },
      screenshots: {
        before: `data:image/png;base64,${screenshotBefore}`,
        after: `data:image/png;base64,${screenshotAfter}`
      }
    });

  } catch (error) {
    console.error('❌ Chyba:', error.message);
    
    if (browser) {
      await browser.close();
    }

    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Zkontrolujte, zda je URL platná a Netflix stránka je dostupná'
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
