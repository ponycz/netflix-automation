const express = require('express');
const puppeteer = require('puppeteer');

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
    // Spuštění prohlížeče
    console.log('🚀 Spouštím Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Nastavení viewportu
    await page.setViewport({ width: 1920, height: 1080 });

    // Nastavení user agent (aby to vypadalo jako normální prohlížeč)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('🌐 Otevírám Netflix URL...');
    
    // Otevření stránky
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    console.log('⏳ Čekám na načtení tlačítka...');

    // Možné selektory pro potvrzovací tlačítko (Netflix může používat různé)
    const possibleSelectors = [
      'button[data-uia="confirmation-button"]',
      'button[data-uia="confirm-button"]',
      'button[type="submit"]',
      'button.btn-confirm',
      'a[data-uia="confirmation-link"]',
      '.primary-button',
      'button.nfBtn-primary'
    ];

    let buttonFound = false;
    let usedSelector = null;

    // Zkusíme najít tlačítko pomocí různých selektorů
    for (const selector of possibleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        buttonFound = true;
        usedSelector = selector;
        console.log(`✅ Tlačítko nalezeno pomocí: ${selector}`);
        break;
      } catch (e) {
        console.log(`❌ Selektor ${selector} nenalezen, zkouším další...`);
      }
    }

    if (!buttonFound) {
      // Pokud nenajdeme tlačítko, zkusíme najít podle textu
      console.log('🔍 Hledám tlačítko podle textu...');
      try {
        await page.waitForFunction(
          () => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            return buttons.some(btn => 
              btn.textContent.includes('Potvrdit') || 
              btn.textContent.includes('Confirm') ||
              btn.textContent.includes('Aktualizovat')
            );
          },
          { timeout: 10000 }
        );
        usedSelector = 'text-based';
        buttonFound = true;
        console.log('✅ Tlačítko nalezeno podle textu');
      } catch (e) {
        throw new Error('Potvrzovací tlačítko nebylo nalezeno na stránce');
      }
    }

    // Screenshot před kliknutím (pro debugging)
    const screenshotBefore = await page.screenshot({ encoding: 'base64' });
    console.log('📸 Screenshot před kliknutím pořízen');

    // Kliknutí na tlačítko
    console.log('👆 Klikám na tlačítko...');
    
    if (usedSelector === 'text-based') {
      // Kliknutí podle textu
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const confirmButton = buttons.find(btn => 
          btn.textContent.includes('Potvrdit') || 
          btn.textContent.includes('Confirm') ||
          btn.textContent.includes('Aktualizovat')
        );
        if (confirmButton) confirmButton.click();
      });
    } else {
      // Kliknutí pomocí selektoru
      await page.click(usedSelector);
    }

    // Počkáme na reakci stránky
    console.log('⏳ Čekám na dokončení...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Screenshot po kliknutí
    const screenshotAfter = await page.screenshot({ encoding: 'base64' });
    console.log('📸 Screenshot po kliknutí pořízen');

    // Získání finální URL (pro ověření)
    const finalUrl = page.url();
    console.log(`✅ Finální URL: ${finalUrl}`);

    await browser.close();

    console.log('✅ Úspěšně dokončeno!');

    res.json({
      success: true,
      message: 'Netflix domácnost byla úspěšně potvrzena',
      details: {
        originalUrl: url,
        finalUrl: finalUrl,
        buttonSelector: usedSelector,
        timestamp: new Date().toISOString()
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
