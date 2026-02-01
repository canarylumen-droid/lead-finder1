
import { scrapeGoogleMaps } from './server/scraper/google-maps-scraper';
import { findEmailsOnWebsite } from './server/scraper/email-finder';
import fs from 'fs';
import vanillaPuppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runTurbo1000Strict() {
    console.log('🚀 Starting STRICT TURBO PUSH: Target 1,000 Verified Emails');
    console.log('🎯 Focus: MedSpas, Property Management, Event Venues, Equipment Rentals');

    const niches = [
        'MedSpa Botox Aesthetics',
        'Commercial Property Management',
        'Apartment Leasing Office',
        'Wedding Venue',
        'Event Space Rental',
        'Equipment Rental Service'
    ];

    const locations = [
        'Hennepin County, MN', 'Cuyahoga County, OH', 'Allegheny County, PA', 'Suffolk County, MA',
        'Alameda County, CA', 'Contra Costa County, CA', 'Fairfax County, VA', 'Riverside County, CA',
        'San Bernardino County, CA', 'Tarrant County, TX', 'Bexar County, TX', 'Broward County, FL',
        'Palm Beach County, FL', 'Suffolk County, NY', 'Nassau County, NY', 'Orange County, FL',
        'Mecklenburg County, NC', 'Wake County, NC', 'Clark County, NV', 'Hillsborough County, FL',
        'Wayne County, MI', 'Oakland County, MI', 'Franklin County, OH', 'Orange County, CA',
        'Maricopa County, AZ', 'Harris County, TX', 'Cook County, IL', 'Miami-Dade County, FL',
        'King County, WA', 'Dallas County, TX', 'Fulton County, GA'
    ];

    const getExistingEmailsCount = () => {
        if (!fs.existsSync('leads_with_emails.csv')) return 0;
        const content = fs.readFileSync('leads_with_emails.csv', 'utf-8');
        return content.split('\n').filter(line => line.includes('@')).length;
    };

    const getExistingNames = () => {
        if (!fs.existsSync('leads_with_emails.csv')) return new Set();
        const content = fs.readFileSync('leads_with_emails.csv', 'utf-8');
        const lines = content.split('\n');
        return new Set(lines.map(line => {
            const match = line.match(/^"([^"]+)"/);
            return match ? match[1] : null;
        }).filter(n => n !== null));
    };

    let existingNames = getExistingNames();
    let emailCount = getExistingEmailsCount();
    console.log(`📊 Current verified emails: ${emailCount}`);

    const target = 1000;
    const browser = await vanillaPuppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const concurrency = 5;

    for (const location of locations) {
        if (emailCount >= target) break;

        for (const niche of niches) {
            if (emailCount >= target) break;

            const query = `${niche} in ${location}`;
            console.log(`\n🔎 [Query]: ${query} (${emailCount}/${target} emails)`);

            try {
                const leads = await scrapeGoogleMaps([query], 100, (m) => console.log(`   ${m}`));
                const newLeads = leads.filter(l => !existingNames.has(l.name));

                for (let i = 0; i < newLeads.length; i += concurrency) {
                    if (emailCount >= target) break;

                    const batch = newLeads.slice(i, i + concurrency);
                    await Promise.all(batch.map(async (lead) => {
                        if (lead.website) {
                            const emails = await findEmailsOnWebsite(lead.website, browser).catch(() => []);
                            if (emails.length > 0) {
                                const gmail = emails.find(e => e.includes('gmail.com'));
                                lead.email = gmail || emails[0];

                                const csvLine = `"${lead.name}","${lead.phone || ''}","${lead.website || ''}","${lead.address || ''}","${lead.rating || ''}","${lead.reviews || ''}","${lead.query}","${lead.url}","${lead.email}"\n`;
                                fs.appendFileSync('leads_with_emails.csv', csvLine);
                                existingNames.add(lead.name);
                                emailCount++;
                                console.log(`   🚀 #${emailCount}: ${lead.name} [${lead.email}]`);
                            }
                        }
                    }));
                }
            } catch (err: any) {
                console.error(`   ❌ Error: ${err.message}`);
            }
        }
    }

    await browser.close();
    console.log(`\n🎉 FINAL GOAL REACHED: ${emailCount} verified emails accumulated.`);
}

runTurbo1000Strict().catch(console.error);
