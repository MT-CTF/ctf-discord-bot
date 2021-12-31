const Discord = require("discord.js");
const { SlashCommandBuilder } = require('@discordjs/builders');

const discordClient = new Discord.Client({
	intents: [
		Discord.Intents.FLAGS.GUILDS,
		Discord.Intents.FLAGS.GUILD_MESSAGES,
		Discord.Intents.FLAGS.GUILD_INTEGRATIONS,
	]
});

//TODO: enable redis server again

//const redisClient = require("redis").createClient();

const guildId = process.env.GUILD_ID;
const rankingsChannel = process.env.RANKINGS_CHANNEL;
const token = process.env.TOKEN;

const prefix = "!";

let staffMessages = []
let statsMap = null;

function formatLeaderboard(list, mode) {
	const rankingsEmbed = new Discord.MessageEmbed()
		.setColor("#0099ff")
		.setTitle("CTF Rankings for mode " + mode);

	const max = Math.min(60, list.length);
	for (var i = 0; i < max; i += 20) {
		const from = i;
		const to = i + 20

		const newContent = list.slice(from, to)
			.map(stats => {
				let kd = stats.kills || 0;
				kd /= stats.deaths || 1;

				stats.name = stats.name.replace("_", "\\_")

				return `**${stats.place}. ${stats.name}**\nK/D: ${kd.toFixed(1)} - Score: *${Math.round(stats.score)}*`;
			})
			.join("\n");

		rankingsEmbed.addField(`__Top ${from+1} - ${to}__`, newContent, true)
	}

	return rankingsEmbed;
}

async function updateRankingsChannel(statsList) {
	if (!rankingsChannel) {
		return;
	}

	const channel = discordClient.channels.cache.get(rankingsChannel);
	if (!channel) {
		return;
	}

	let rankings = [];
	for (const mode of [...statsList.keys()].sort()) {
		rankings.push(formatLeaderboard(statsList.get(mode), mode));
	}

	const messages = await channel.messages.fetch({ limit: rankings.length });
	if (messages.size < rankings.length) {
		for (var i = 0; i < rankings.length; ++i) {
			await channel.send(rankings[i]);
		}
	} else {
		let it = messages.values()
		for (var i = 0; i < rankings.length; ++i) {
			await it.next().value.edit(rankings[rankings.length - i - 1]);
		}
	}
}

async function updateRankings() {
	let statsList = new Map();
	for (const key of await redisClient.keys("ctf_mode_*")) {
		const [rawMode, name] = key.split("|", 2);
		const mode = rawMode.substring(9).split("_").map((word) => {
			return word[0].toUpperCase() + word.substring(1);
		}).join(" ")

		let stats = JSON.parse(await redisClient.get(key));

		if (stats) {
			stats["name"] = name;
			stats.score = stats.score || 0;

			if (statsList.get(mode) === undefined) {
				statsList.set(mode, []);
			}

			statsList.get(mode).push(stats);
		}
	}

	statsMap = new Map();

	for (const [mode, stats] of statsList) {
		stats.sort((a, b) => b.score - a.score);
		stats.forEach((stat, i) => {
			stat.place = i + 1;
		});

		statsMap.set(mode, new Map());
		for (const stat of stats) {
			statsMap.get(mode).set(stat.name.toLowerCase(), stat);
		}
	}

	await updateRankingsChannel(statsList)
}

function ordinalSuffixOf(i) {
	var j = i % 10, k = i % 100;
	if (j == 1 && k != 11) {
		return i + "st";
	}
	if (j == 2 && k != 12) {
		return i + "nd";
	}
	if (j == 3 && k != 13) {
		return i + "rd";
	}
	return i + "th";
}

function normValue(v) {
	return Math.round(v || 0);
}

function formatRanking(stats, mode) {
	let kd = stats.kills || 0;
	kd /= stats.deaths || 1;

	const fields = [
		{ name: "Kills", value: normValue(stats.kills), inline: true },
		{ name: "Deaths", value: normValue(stats.deaths), inline: true },
		{ name: "K/D", value: kd.toFixed(1), inline: true },
		{ name: "Bounty kills", value: normValue(stats.bounty_kills), inline: true },
		{ name: "Captures", value: normValue(stats.flag_captures), inline: true },
		{ name: "HP healed", value: normValue(stats.hp_healed), inline: true },
	]

	return new Discord.MessageEmbed()
		.setColor("#0099ff")
		.setTitle(`${stats.name}, ${ordinalSuffixOf(stats.place)}, ${mode}`)
		.setDescription(`${stats.name} is in ${ordinalSuffixOf(stats.place)} place, with ${Math.round(stats.score)} score, ${mode} mode.`)
		.addFields(fields)
		.setTimestamp();
}

function handleRankRequest(message, command, args) {
	if (!statsMap) {
		message.channel.send("Please wait, stats are still loading...");
		return;
	}

	const username = message.author.username.trim();
	const nickname = message.member.nickname ? message.member.nickname.trim() : username;
	const name = args.length > 0 ? args[0].trim() : nickname;

	let playerStats = [];

	for (const mode of [...statsMap.keys()].sort()) {
		let stat = statsMap.get(mode).get(name.toLowerCase());
		if (!stat && args.length == 0) {
			stat = statsMap.get(mode).get(username.toLowerCase());
		}
		if (stat) {
			playerStats.push([stat, mode]);
		}
	}

	if (playerStats.length > 0) {
		for (const [stat, mode] of playerStats) {
			message.channel.send(formatRanking(stat, mode));
		}

		if (args.length > 0 && (name.toLowerCase() == nickname.toLowerCase() || name.toLowerCase() == username.toLowerCase())) {
			message.channel.send(`_pst: you can just use \`!${command}\`_`);
		}
	} else {
		if (args.length > 0) {
			message.channel.send(`Unable to find user ${name}`);
		} else if (username.toLowerCase() != nickname.toLowerCase()) {
			message.channel.send(`Unable to find ${nickname} or ${username}, please provide username explicitly like so: \`!rank username\``);
		} else {
			message.channel.send(`Unable to find ${nickname}, please provide username explicitly like so: \`!rank username\``);
		}
	}
}

const error_embed = new Discord.MessageEmbed()
	.setColor("RED")
	.setDescription("You dont have the permission to run this command.")

// commands definition

const commands = [];

//fixme
commands.push(new SlashCommandBuilder()
	.setName("rank")
	.setDescription("Shows ingame rankings")
);

commands.push(new SlashCommandBuilder()
	.setName("x")
	.setDescription("Send messages on staff channel")
	.addStringOption(option => option
		.setName('message')
		.setDescription('Enter message')
		.setRequired(true)
	)
);

discordClient.on("ready", () => {
	console.log(`Logged in as ${discordClient.user.tag}!`);

	const guild = client.guilds.resolve(guildId);

	//push commands to server
	guild.commands.set(commands).catch(console.log);
});

discordClient.on("interactionCreate", async(interaction) => {
	if (!interaction.isCommand()) {
		return
	}

	const {commandName, member, memberPermissions, options} = interaction

	//handle commands
	if (commandName === "x") {
		if (!memberPermissions.has("KICK_MEMBERS", true)) {
			return interaction.reply({
				embeds: [error_embed],
				ephemeral: true,
			})
		}

		staffMessages.push(`<${member.user.username}@Discord> ${options.getString("message")}`);

		interaction.reply({
			embeds: [
				new Discord.MessageEmbed()
					.setColor("BLUE")
					.setDescription(`**${member.user.username}**: ${options.getString("message")}`)
			],
			ephemeral: false,
		})
	}
});

discordClient.on("message", message => {
	if (message.content[0] != prefix) {
		return;
	}

	const args = message.content.slice(prefix.length).trim().split(" ");
	const command = args.shift().toLowerCase();

	if (command == "rank" || command == "r" || command == "rankings") {
		handleRankRequest(message, command, args);
	} else if (command == "leaders") {
		if (rankingsChannel) {
			message.channel.send(`<#${rankingsChannel}>`);
		}
	} else if (command == "help") {
		const helpEmbed = new Discord.MessageEmbed()
			.setTitle("Commands")
			.setColor("#0000E5")
			.addField(prefix + "rank", "Shows ingame rankings", false)
			.addField(prefix + "leaders", "Shows the top 60 leaderboard or links to the dedicated channel for it", false)
			.addField(prefix + "help", "Shows the available commands", false)
			.addField(prefix + "mute <@username>", "Mutes a user", false)
			.addField(prefix + "unmute <@username>", "Unmutes a user", false)

		return message.channel.send(helpEmbed);
	} else if (command == "mute") {
		if (!message.member.hasPermission("KICK_MEMBERS"))
			return message.reply("You dont have the permission to run this command");

		let muteuser = message.guild.member(message.mentions.users.first() || message.guild.members.get(args[0]));
		if (!muteuser)
			return message.reply("Couldn't find user");

		if (muteuser.hasPermission("KICK_MEMBERS"))
			return message.reply("Can't mute them, the user you are trying to mute is a staff member!");

		let muterole = message.guild.roles.cache.find(role => role.name === "Muterated");
		muteuser.roles.add(muterole.id);

		message.reply(`<@${muteuser.id}> has been muted`);
	} else if (command == "unmute") {
		if (!message.member.hasPermission("KICK_MEMBERS"))
			return message.reply("You dont have the permission to run this command");

		let unmuteuser = message.guild.member(message.mentions.users.first() || message.guild.members.get(args[0]));
		if (!unmuteuser)
			return message.reply("Couldn't find user");

		let muterole = message.guild.roles.cache.find(role => role.name === "Muterated");
		(unmuteuser.roles.remove(muterole.id));

		message.reply(`<@${unmuteuser.id}> has been unmuted`);
	} else if (command == "x") {
		if (!message.member.hasPermission("KICK_MEMBERS"))
			return message.reply("You dont have the permission to run this command");

		staffMessages.push(`<${message.member.user.username}@Discord> ${message.content.substring(2).trim()}`);

		message.react('☑️');
	}
});

async function main() {
	await discordClient.login(token);
	///await redisClient.connect();

	//await updateRankings();
	//setInterval(updateRankings, 60000);

	var http = require('http');
	http.createServer(function (req, res) {
		if (req.method == "GET" && staffMessages.length > 0) {
			res.writeHead(200, {'Content-Type': 'text/plain'});
			console.log("Relaying staff messages: " + staffMessages.join("-|-"));
			res.write(JSON.stringify(staffMessages));
			staffMessages = [];
		}

		res.writeHead(200);
		res.end();
	}).listen(31337, '127.0.0.1');
}
main()
