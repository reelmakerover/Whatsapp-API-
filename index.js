// ================================
// 🧠 WHATSAPP MARKETING AUTOMATION BOT
// Author: Yash Saini (Satwik Universe)
// Description: Sends WhatsApp messages to clients listed in Excel file using message templates.
// ================================

// ===== IMPORT REQUIRED MODULES =====
const qrcode = require('qrcode-terminal');   // For generating QR code in terminal
const { Client, LocalAuth } = require('whatsapp-web.js'); // WhatsApp automation library
const XLSX = require('xlsx');                // For reading/writing Excel files
const readline = require('readline');        // For taking user input in terminal
const fs = require('fs');                    // For reading/writing files
const path = require('path');                // For handling file paths

// ===== CONFIGURATION =====
const CLIENT_FILE = './clients.xlsx';   // Excel file that contains client list
const LOG_FILE = './sent_log.xlsx';     // Excel file to log sent messages
const TEMPLATES_DIR = './Templates';    // Folder containing message templates (.txt files)
const DEFAULT_COUNTRY = '91';           // Default country code (India)
const MIN_DELAY = 3000;   // Minimum delay between messages (in ms)
const MAX_DELAY = 10000;  // Maximum delay between messages (in ms)
const BATCH_PAUSE_AFTER = 20;          // Number of messages after which to pause
const BATCH_PAUSE_MS = 120000;         // Pause duration (2 minutes)
// ==========================

// Create readline interface for taking terminal inputs
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Initialize WhatsApp client using LocalAuth (saves session locally)
const client = new Client({ authStrategy: new LocalAuth() });

// ===== EVENT: When QR code is generated =====
client.on('qr', qr => {
  console.log('📱 Scan the QR code with WhatsApp (Linked Devices → Link a device):');
  qrcode.generate(qr, { small: true });
});

// ===== EVENT: When WhatsApp is connected successfully =====
client.on('ready', () => {
  console.log('\n✅ WhatsApp connected!');
  startCampaign(); // Start campaign when ready
});

// ===== EVENT: Authentication Failure =====
client.on('auth_failure', msg => console.error('AUTH FAILURE', msg));

// Initialize the WhatsApp connection
client.initialize();

// ===== HELPER FUNCTIONS =====

// Sleep function for creating delays between messages
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Generate random delay between MIN_DELAY and MAX_DELAY
function randomDelay(min = MIN_DELAY, max = MAX_DELAY) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Read Excel file and convert it to JSON
function readExcel(file) {
  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// Append a single log entry to sent_log.xlsx
function appendToLog(row) {
  let existing = [];
  if (fs.existsSync(LOG_FILE)) {
    try {
      const wb = XLSX.readFile(LOG_FILE);
      const sh = wb.Sheets[wb.SheetNames[0]];
      existing = XLSX.utils.sheet_to_json(sh, { defval: '' });
    } catch { existing = []; }
  }
  existing.push(row);
  const newSheet = XLSX.utils.json_to_sheet(existing);
  const newBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newBook, newSheet, 'Log');
  XLSX.writeFile(newBook, LOG_FILE);
}

// Get list of all template files from Templates folder
function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.txt'));
}

// Load content of a specific template file
function loadTemplate(name) {
  const p = path.join(TEMPLATES_DIR, name);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

// Replace variables inside template with actual client data
// Example: {{Name}} → Yash, {{Mobile}} → 918949xxxxxx
function replaceVars(template, row) {
  return template
    .replace(/{{\s*Name\s*}}/gi, row.Name || '')
    .replace(/{{\s*Mobile\s*}}/gi, row.Mobile || '')
    .replace(/{{\s*SNo\s*}}/gi, row.SNo || '')
    .replace(/{{\s*Time\s*}}/gi, new Date().toLocaleString());
}

// ===== MAIN FUNCTION: SEND MESSAGES IN BATCH =====
async function sendBatch(clients, startIndex, template) {
  for (let i = startIndex - 1; i < clients.length; i++) {
    const row = clients[i];

    // Clean mobile number
    const raw = String(row.Mobile || '').replace(/\D/g, '');
    if (!raw) {
      console.log(`❌ Row ${i+1}: Missing number for ${row.Name || 'Unknown'}, skipping.`);
      appendToLog({ SNo: row.SNo || i+1, Name: row.Name || '', Mobile: '', Status: 'NO_NUMBER', Time: new Date().toLocaleString() });
      continue;
    }

    // Add country code if 10 digits
    const mobile = raw.length === 10 ? DEFAULT_COUNTRY + raw : raw;
    const chatId = `${mobile}@c.us`;

    // Replace variables in the template
    const message = replaceVars(template, row);

    // Try sending the message
    console.log(`⏳ Sending to ${row.Name || mobile} (${mobile})...`);
    try {
      await client.sendMessage(chatId, message);
      console.log(`✅ Sent to ${row.Name || mobile}`);
      appendToLog({ SNo: row.SNo || i+1, Name: row.Name || '', Mobile: mobile, Status: 'SENT', Time: new Date().toLocaleString() });
    } catch (err) {
      console.log(`❌ Failed for ${row.Name || mobile}:`, err.message);
      appendToLog({ SNo: row.SNo || i+1, Name: row.Name || '', Mobile: mobile, Status: 'FAILED', Time: new Date().toLocaleString() });
    }

    // Wait for random delay before next message
    const delay = randomDelay();
    console.log(`🕒 Waiting ${Math.round(delay/1000)}s before next message...`);
    await sleep(delay);
  }

  // After completing all messages
  console.log('\n🎉 Batch finished.\n');
  askAgain(); // Ask user if they want to send another batch
}

// ===== AFTER BATCH COMPLETES, ASK USER TO CONTINUE =====
function askAgain() {
  rl.question('🔁 Do you want to send another batch? (y/n): ', (ans) => {
    if (ans.toLowerCase() === 'y') startCampaign();
    else {
      console.log('👋 Exiting...');
      rl.close();
      process.exit(0);
    }
  });
}

// ===== START CAMPAIGN FUNCTION =====
// Asks user for starting serial and template selection
function startCampaign() {
  const clients = readExcel(CLIENT_FILE); // Load client data

  rl.question('🟢 Enter starting serial number: ', async (num) => {
    const s = parseInt(num) || 1;
    const tplList = listTemplates(); // Load available templates

    if (tplList.length === 0) {
      console.log('⚠️ No templates found in templates/ folder!');
      rl.close();
      return;
    }

    // Display all available templates
    console.log('\nAvailable templates:');
    tplList.forEach((t, i) => console.log(`${i + 1}) ${t}`));

    // Ask which template to use
    rl.question('\nChoose template number: ', async (tn) => {
      const tIndex = parseInt(tn);
      if (!tIndex || !tplList[tIndex - 1]) {
        console.log('❌ Invalid choice!');
        rl.close();
        return;
      }

      // Load chosen template and start sending messages
      const templateContent = loadTemplate(tplList[tIndex - 1]);
      console.log(`\n📨 Selected template: ${tplList[tIndex - 1]}\n`);
      await sendBatch(clients, s, templateContent);
    });
  });
}
