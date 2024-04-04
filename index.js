require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, Events, ActivityType } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { config } = require('./config');
const { ConversationManager } = require('./conversationManager');
const { CommandHandler } = require('./commandHandler');
const async = require('async');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const conversationManager = new ConversationManager();
const commandHandler = new CommandHandler();
const conversationQueue = async.queue(processConversation, 1);

const activities = [
  { name: 'Assisting users', type: ActivityType.Playing },
  { name: 'Powered by Google Generative AI', type: ActivityType.Listening },
  { name: 'Available for chat', type: ActivityType.Watching }
];
let activityIndex = 0;

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}!`);
  // Set the initial status
  client.user.setPresence({
    activities: [activities[activityIndex]],
    status: 'online',
  });
  // Change the activity every 30000ms (30 seconds)
  setInterval(() => {
    activityIndex = (activityIndex + 1) % activities.length;
    client.user.setPresence({
      activities: [activities[activityIndex]],
      status: 'online',
    });
  }, 30000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'clear') {
    conversationManager.clearHistory(interaction.user.id);
    await interaction.reply('Your conversation history has been cleared.');
    return;
  }

  if (interaction.commandName === 'save') {
    await commandHandler.saveCommand(interaction, [], conversationManager);
    return;
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    const isDM = message.channel.type === ChannelType.DM;
    if (message.mentions.users.has(client.user.id) || isDM) {
      const messageContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();
      if (messageContent === '') {
        await message.reply("> `It looks like you didn't say anything. What would you like to talk about?`");
        return;
      }
      conversationQueue.push({ message, messageContent });
    }
  } catch (error) {
    console.error('Error processing the message:', error);
    await message.reply('Sorry, something went wrong!');
  }
});

async function processConversation({ message, messageContent }) {
  try {
    await message.channel.sendTyping();
    const model = await genAI.getGenerativeModel({ model: config.modelName });
    const chat = model.startChat({
      history: conversationManager.getHistory(message.author.id),
      safetySettings: config.safetySettings,
    });
    const botMessage = await message.reply('> `Generating a response...`');
    await conversationManager.handleModelResponse(botMessage, () => chat.sendMessageStream(messageContent), message);
    // Check if it's a new conversation or the bot is mentioned
    if (conversationManager.isNewConversation(message.author.id) || message.mentions.users.has(client.user.id)) {
      const clearCommandMessage = `
        > **Remember to use the \`/clear\` command to start a new conversation when needed. This helps to maintain context and ensures that the AI responds accurately to your messages.**
      `;
      await message.channel.send(clearCommandMessage);
    }
  } catch (error) {
    console.error('Error processing the conversation:', error);
    await message.reply('Sorry, something went wrong!');
  }
}

client.login(process.env.DISCORD_BOT_TOKEN);