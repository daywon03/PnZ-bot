// Telegram Bot Server
require('dotenv').config();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = process.env.NEXT_PUBLIC_BASE_URL ;

// Vérifications essentielles
if (!BOT_TOKEN) {
  console.error('❌ ERROR: TELEGRAM_BOT_TOKEN is not defined in environment variables!');
  console.error('Please set TELEGRAM_BOT_TOKEN in your .env file or environment.');
  process.exit(1);
}

if (!API_URL) {
  console.error('❌ ERROR: NEXT_PUBLIC_BASE_URL is not defined in environment variables!');
  console.error('Please set NEXT_PUBLIC_BASE_URL in your .env file or environment.');
  process.exit(1);
}

const conversationState = new Map();

async function initBot() {
  try {
    const TelegramBot = (await import('node-telegram-bot-api')).default;
    const axios = (await import('axios')).default;
    
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    console.log('✅ Telegram Bot Started Successfully!');
    console.log('Bot Username: @PnZ_contact_bot');
    console.log('API URL:', API_URL);
    
      // Vérifier que le bot fonctionne
      try {
        const botInfo = await bot.getMe();
        console.log('✅ Telegram Bot Started Successfully!');
        console.log('Bot Username:', `@${botInfo.username}`);
        console.log('Bot ID:', botInfo.id);
        console.log('Bot Name:', botInfo.first_name);
        console.log('API URL:', API_URL);
      } catch (error) {
        console.error('❌ Failed to get bot info:', error.message);
        if (error.response) {
          console.error('Response:', error.response.data);
        }
        throw error;
      }
      
    // Handle /start command
    bot.onText(/\/start(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id;
      const linkToken = match[1] ? match[1].trim() : '';
      
      console.log(`/start from user ${telegramId}, token: ${linkToken}`);
      
      if (linkToken) {
        try {
          const response = await axios.post(`${API_URL}/api/telegram/link`, {
            telegram_id: telegramId,
            link_token: linkToken
          });
          
          await bot.sendMessage(chatId, 
            `✅ Account linked successfully!\n\n` +
            `Welcome ${response.data.user.name}!\n\n` +
            `You can now start adding contacts by sending /start again.`
          );
          return;
        } catch (error) {
          await bot.sendMessage(chatId, 
            `❌ Failed to link account.\n\n` +
            `Please generate a new link from the web dashboard.`
          );
          return;
        }
      }
      
      conversationState.set(telegramId, { step: 1, data: {} });
      
      await bot.sendMessage(chatId,
        `👋 Hi! Let's add a new contact to your PnZ Contacts.\n\n` +
        `What's the person's full name?`
      );
    });
    
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id;
      const text = msg.text;
      
      if (text && text.startsWith('/')) return;
      
      const state = conversationState.get(telegramId);
      if (!state) return;
      
      const { step, data } = state;
      
      try {
        if (step === 1) {
          data.name = text;
          state.step = 2;
          conversationState.set(telegramId, state);
          await bot.sendMessage(chatId, `Great! What's ${data.name}'s position/job title?`);
        }
        else if (step === 2) {
          data.position = text;
          state.step = 3;
          conversationState.set(telegramId, state);
          await bot.sendMessage(chatId, `What company does ${data.name} work for?`);
        }
        else if (step === 3) {
          data.company = text;
          state.step = 4;
          conversationState.set(telegramId, state);
          await bot.sendMessage(chatId,
            `What's ${data.name}'s Telegram contact? (username or phone)\n\n` +
            `You can type "skip" if you don't have this information.`
          );
        }
        else if (step === 4) {
          data.telegram_contact = text.toLowerCase() === 'skip' ? '' : text;
          state.step = 5;
          conversationState.set(telegramId, state);
          await bot.sendMessage(chatId,
            `Any additional notes about ${data.name}?\n\n` +
            `(You can type "skip" to skip this)`
          );
        }
        else if (step === 5) {
          data.notes = text.toLowerCase() === 'skip' ? '' : text;
          state.step = 6;
          conversationState.set(telegramId, state);
          await bot.sendMessage(chatId,
            `Finally, would you like to add a profile picture?\n\n` +
            `You can send me a photo or type "skip" to skip this step.`,
            {
              reply_markup: {
                keyboard: [[{ text: '⏭️ Skip Photo' }]],
                one_time_keyboard: true,
                resize_keyboard: true
              }
            }
          );
        }
        else if (step === 6) {
          if (text.toLowerCase() === 'skip' || text === '⏭️ Skip Photo') {
            await submitContact(bot, chatId, telegramId, data, axios);
            conversationState.delete(telegramId);
          } else {
            await bot.sendMessage(chatId, `Please send a photo or press "⏭️ Skip Photo".`);
          }
        }
      } catch (error) {
        console.error('Error:', error);
        await bot.sendMessage(chatId, `❌ An error occurred. Please try /start again`);
        conversationState.delete(telegramId);
      }
    });
    
    bot.on('photo', async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id;
      
      const state = conversationState.get(telegramId);
      if (!state || state.step !== 6) return;
      
      try {
        const photo = msg.photo[msg.photo.length - 1];
        await bot.sendMessage(chatId, `📸 Processing photo...`);
        
        const file = await bot.getFile(photo.file_id);
        const photoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/${file.file_path}`;
        
        const response = await (await import('axios')).default.get(photoUrl, { responseType: 'arraybuffer' });
        const base64Image = `data:image/jpeg;base64,${Buffer.from(response.data).toString('base64')}`;
        
        state.data.photo = base64Image;
        await submitContact(bot, chatId, telegramId, state.data, (await import('axios')).default);
        conversationState.delete(telegramId);
      } catch (error) {
        console.error('Photo error:', error);
        await bot.sendMessage(chatId, `❌ Failed to process photo. Saving without photo...`);
        await submitContact(bot, chatId, telegramId, state.data, (await import('axios')).default);
        conversationState.delete(telegramId);
      }
    });
    
    async function submitContact(bot, chatId, telegramId, data, axios) {
      try {
        await axios.post(`${API_URL}/api/telegram/contact`, {
          telegram_id: telegramId,
          name: data.name,
          position: data.position,
          company: data.company,
          telegram_contact: data.telegram_contact,
          notes: data.notes,
          photo: data.photo || ''
        });
        
        await bot.sendMessage(chatId,
          `✅ Contact added successfully!\n\n` +
          `📋 Summary:\n` +
          `👤 Name: ${data.name}\n` +
          `💼 Position: ${data.position}\n` +
          `🏢 Company: ${data.company}\n` +
          `📱 Telegram: ${data.telegram_contact || 'N/A'}\n` +
          `📝 Notes: ${data.notes || 'N/A'}\n` +
          `🖼️ Photo: ${data.photo ? 'Added' : 'N/A'}\n\n` +
          `Thank you for connecting! 👋`,
          { reply_markup: { remove_keyboard: true } }
        );
      } catch (error) {
        console.error('Submit error:', error);
        if (error.response?.data?.needsLinking) {
          await bot.sendMessage(chatId,
            `❌ Telegram not linked.\n\n` +
            `Visit the dashboard and scan QR code:\n${API_URL}`
          );
        } else {
          await bot.sendMessage(chatId, `❌ Failed to save contact. Error: ${error.message}`);
        }
      }
    }
    
    bot.on('polling_error', (error) => {
      console.error('Polling error:', error.code);
    });
    
  } catch (error) {
    console.error('Init error:', error);
  }
}

initBot();
console.log('Starting Telegram Bot...');
