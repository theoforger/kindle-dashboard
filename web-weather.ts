import { chromium } from 'playwright';
import sharp from 'sharp';
import path from 'path';

const DASHBOARD_WIDTH = 1448;
const DASHBOARD_HEIGHT = 1072;
// Adjust these values to shift the viewport without changing screenshot dimensions
const HORIZONTAL_OFFSET = 70;
const VERTICAL_OFFSET = 860;
const TIMEZONE = process.env.TIMEZONE ?? "America/Edmonton";
const WEATHER_LOCATION = {
  lat: process.env.LATITUDE ? parseFloat(process.env.LATITUDE) : 50.041,
  lon: process.env.LONGITUDE ? parseFloat(process.env.LONGITUDE) : -110.677,
};

function formatDateTime() {
  const date = new Date();
  return (
    date
      .toLocaleString("en-US", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TIMEZONE,
        hour12: true,
      })
      .replace(",", " |") + " MST"
  );
}

export async function captureWeatherScreenshot(batteryPercentage: number) {
    console.log('Starting screenshot capture...');
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: {
            width: DASHBOARD_WIDTH + 700,
            height: DASHBOARD_HEIGHT + 900,
        }
    });

    try {
        const page = await context.newPage();
        await page.goto(`https://weather.gc.ca/en/location/index.html?coords=${WEATHER_LOCATION.lat},${WEATHER_LOCATION.lon}`);

        // Remove top margin from mrgn-tp-lg class
        await page.addStyleTag({
            content: '.mrgn-tp-lg { margin-top: 0 !important; }'
        });

        // Set zoom level to 120%
        await page.evaluate(() => {
            document.body.style.zoom = '181%';
        });

        // Wait for the content to load
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // Take screenshot of the specified region within the larger viewport
        const screenshot = await page.screenshot({
            clip: {
                x: HORIZONTAL_OFFSET,
                y: VERTICAL_OFFSET,
                width: DASHBOARD_WIDTH,
                height: DASHBOARD_HEIGHT
            },
        });
        console.log('Screenshot captured');
        // Create a new buffer with the date and battery text
        const batteryBuffer = await sharp({
            create: {
                width: 900,
                height: 50,
                channels: 3,
                background: { r: 245, g: 245, b: 245 }
            }
        })
            .composite([{
                input: {
                    text: {
                        text: `[${formatDateTime()}]   [Battery: ${batteryPercentage}%]`,
                        font: './Roboto-Bold.ttf',
                        rgba: true,
                        dpi: 220
                    }
                }
            }])
            .png()
            .toBuffer();
        console.log('Battery buffer created');

        // Process the image with Sharp and add the battery overlay
        const processedImage = await sharp(screenshot)
            .composite([{
                input: batteryBuffer,
                top: 355,
                left: DASHBOARD_WIDTH - 900
            }])
            .toBuffer();


        await sharp(processedImage)
            .toColorspace('b-w')
            .removeAlpha()
            .rotate(90)
            .png()
            .toFile('public/dash.png');
        console.log('Final dashboard image created');

    } catch (error) {
        console.error('Screenshot capture failed:', error);
        throw error;
    } finally {
        await browser.close();
    }
}


// captureWeatherScreenshot();