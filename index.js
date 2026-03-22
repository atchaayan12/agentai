// ====== # made by x hub hostinger on top join noww : https://discord.gg/BFnk5v74pf ======

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

// ====== BASIC SETTINGS ======
const MEMORY_FILE = path.join(__dirname, "memory.json");
const CONFIG_FILE = path.join(__dirname, "config.json");

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const MAX_HISTORY_MESSAGES = 16; // old chat save, but limit
const MAX_USER_CHARS = 1800;     // avoid huge spam
const COOLDOWN_MS = 1200;        // fast + anti spam

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJsonSafe(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ====== CONFIG (channel lock etc) ======
const config = readJsonSafe(CONFIG_FILE, {
  aiChannelId: process.env.AI_CHANNEL_ID || "",
  model: DEFAULT_MODEL,
});

function setConfig(patch) {
  Object.assign(config, patch);
  writeJsonSafe(CONFIG_FILE, config);
}

// ====== MEMORY PER CHANNEL ======
const memory = readJsonSafe(MEMORY_FILE, {
  channels: {} // channelId -> [{role, content}]
});

function getChannelMemory(channelId) {
  if (!memory.channels[channelId]) memory.channels[channelId] = [];
  return memory.channels[channelId];
}
function pushToMemory(channelId, role, content) {
  const arr = getChannelMemory(channelId);
  arr.push({ role, content });

  // trim
  while (arr.length > MAX_HISTORY_MESSAGES) arr.shift();
  writeJsonSafe(MEMORY_FILE, memory);
}
function resetMemory(channelId) {
  memory.channels[channelId] = [];
  writeJsonSafe(MEMORY_FILE, memory);
}

// ====== OPENROUTER CALL ======
async function callOpenRouter(messages, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing in .env");

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // optional headers
    "X-Title": process.env.OPENROUTER_APP_NAME || "DiscordPowerAI",
  };
  if (process.env.OPENROUTER_SITE) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE;

  const body = {
    model: model || DEFAULT_MODEL,
    messages,
    temperature: 0.6,
    max_tokens: 600
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content?.trim();
  return out || "Bahi response empty aa gaya 😅";
}

// ====== DISCORD CLIENT ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // IMPORTANT: enable in portal too
  ],
  partials: [Partials.Channel],
});

// ====== SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set AI channel (sirf yahi channel me AI reply karega)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("channel_id")
        .setDescription("Paste channel ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("model")
    .setDescription("Set OpenRouter model")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("name")
        .setDescription("e.g. openai/gpt-4o-mini, anthropic/claude-3.5-sonnet")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Reset AI memory for this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map(c => c.toJSON());

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) throw new Error("DISCORD_TOKEN / CLIENT_ID missing in .env");

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("✅ Slash commands registered");
}

// ====== COOLDOWN ======
const lastUse = new Map(); // userId -> timestamp

function onCooldown(userId) {
  const now = Date.now();
  const prev = lastUse.get(userId) || 0;
  if (now - prev < COOLDOWN_MS) return true;
  lastUse.set(userId, now);
  return false;
}

// ====== HELPERS ======
function cleanText(t) {
  if (!t) return "";
  // prevent mass mentions
  return t.replaceAll("@everyone", "@\u200Beveryone").replaceAll("@here", "@\u200Bhere");
}

// ====== EVENTS ======
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🔒 AI Channel: ${config.aiChannelId || "(not set yet)"}`);
  console.log(`🤖 Model: ${config.model}`);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  try {
    if (i.commandName === "ping") {
      return await i.reply({ content: `🏓 Pong! ${client.ws.ping}ms`, ephemeral: true });
    }

    if (i.commandName === "setchannel") {
      const id = i.options.getString("channel_id", true).trim();
      setConfig({ aiChannelId: id });
      return await i.reply({ content: `✅ AI channel set to: \`${id}\``, ephemeral: true });
    }

    if (i.commandName === "model") {
      const name = i.options.getString("name", true).trim();
      setConfig({ model: name });
      return await i.reply({ content: `✅ Model set: \`${name}\``, ephemeral: true });
    }

    if (i.commandName === "reset") {
      resetMemory(i.channelId);
      return await i.reply({ content: `🧠 Memory reset for this channel ✅`, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (i.replied || i.deferred) {
      await i.editReply({ content: "❌ Error. Console check karo." }).catch(() => {});
    } else {
      await i.reply({ content: "❌ Error. Console check karo.", ephemeral: true }).catch(() => {});
    }
  }
});

// Main AI: only inside set channel
client.on("messageCreate", async (msg) => {
  try {
    if (!msg.guild) return;
    if (msg.author.bot) return;

    const locked = config.aiChannelId;
    if (!locked) return; // not set yet
    if (msg.channelId !== locked) return;

    if (onCooldown(msg.author.id)) return;

    let userText = (msg.content || "").trim();
    if (!userText) return;

    // limit size
    if (userText.length > MAX_USER_CHARS) {
      userText = userText.slice(0, MAX_USER_CHARS) + "…";
    }

    // typing = feels fast
    await msg.channel.sendTyping().catch(() => {});

    const system = {
      role: "system",
      content:
        "You are a super fast, helpful Discord AI assistant. " +
        "Reply short and clear. If user speaks Hinglish/Hindi, reply in Hinglish/Hindi. " +
        "Never reveal secrets/tokens. Avoid @everyone/@here pings."
    };

    const history = getChannelMemory(msg.channelId);

    // add user message to memory first
    pushToMemory(msg.channelId, "user", `(${msg.author.username}) ${userText}`);

    const messages = [
      system,
      ...history.map(m => ({ role: m.role, content: m.content })),
    ];

    const reply = await callOpenRouter(messages, config.model);

    const safe = cleanText(reply);

    // save assistant reply
    pushToMemory(msg.channelId, "assistant", safe);

    // split if too long
    if (safe.length <= 1900) {
      return await msg.reply(safe);
    } else {
      const chunks = safe.match(/[\s\S]{1,1900}/g) || [];
      for (let c of chunks) {
        await msg.channel.send(c);
      }
    }
  } catch (err) {
    console.error(err);
    msg.reply("❌ Bahi error aa gaya. Console me dekh.").catch(() => {});
  }
});

// ====== START ======
(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();

// ====== # made by x hub hostinger on top join noww : https://discord.gg/BFnk5v74pf ======