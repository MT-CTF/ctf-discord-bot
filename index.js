const Discord = require("discord.js");
const fs = require("fs/promises");
const client = new Discord.Client();
const statsPath = process.env.STATS;
const oldStatsPath = process.env.OLD_STATS;
const rankingsChannel = process.env.RANKINGS_CHANNEL;
const prefix = "!";

async function readStats(path) {
	const content = (await fs.readFile(path)).toString();

	let list = {};
	const raw = JSON.parse(JSON.parse(content).players);
	for (let key in raw) {
		list[key.toLowerCase()] = raw[key];
	}

	const orderedList = Object.values(list).sort((a, b) => b.score - a.score);
	orderedList.forEach((stats, i) => {
		stats.place = i + 1;
	});

	return [list, orderedList];
}

let oldStatsList = null;
let statsList = null;

async function updateStats() {
	const ret = await readStats(statsPath);
	statsList = ret[0];
	updateRankingsChannel(ret[1]);
}

async function updateOldStats() {
	oldStatsList = (await readStats(oldStatsPath))[0];
}

updateStats();
updateOldStats();
setInterval(updateStats, 30000);

async function updateRankingsChannel(list) {
	if (!rankingsChannel) {
		return;
	}

	const channel = client.channels.cache.get(rankingsChannel);
	if (!channel) {
		return;
	}

	const rankingsEmbed = new Discord.MessageEmbed()
	.setColor("#0099ff")
	.setTitle("CTF Rankings")

	let rankPlaces = [{from: 0, to: 20}, {from: 20, to: 40}, {from: 40, to: 50}]

	rankPlaces.forEach(function(places) {
		const newContent = list.slice(places.from, places.to)
			.map(stats => {
				let kd = stats.kills;
				if (stats.deaths > 1) {
					kd /= stats.deaths;
				}

				stats.name = stats.name.replace("_", "\\_")

				return `**${stats.place}. ${stats.name}**\nK/D: ${kd.toFixed(1)} - Score: *${Math.round(stats.score)}*`;
			})
			.join("\n");

		rankingsEmbed.addField(`__Top ${places.from+1} - ${places.to}__`, newContent, true)
	});

	const messages = await channel.messages.fetch({ limit: 1 });
	if (messages.size == 0) {
		channel.send(rankingsEmbed);
	} else {
		const message = messages.first();
		message.edit(rankingsEmbed);
	}
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

function formatRanking(stats) {
	let kd = stats.kills;
	if (stats.deaths > 1) {
		kd /= stats.deaths;
	}

	const fields = [
		{ name: "Kills", value: stats.kills, inline: true },
		{ name: "Deaths", value: stats.deaths, inline: true },
		{ name: "K/D", value: kd.toFixed(1), inline: true },
		{ name: "Bounty kills", value: stats.bounty_kills, inline: true },
		{ name: "Captures", value: stats.captures, inline: true },
		{ name: "Attempts", value: stats.attempts, inline: true },
	]

	return new Discord.MessageEmbed()
		.setColor("#0099ff")
		.setTitle(`${stats.name}, ${ordinalSuffixOf(stats.place)}`)
		.setDescription(`${stats.name} is in ${ordinalSuffixOf(stats.place)} place, with ${Math.round(stats.score)} score.`)
		.addFields(fields)
		.setTimestamp();
}

function handleRankRequest(rankList, message, args) {
	if (!rankList) {
		message.channel.send("Please wait, stats are still loading...");
		return;
	}

	const username = message.author.username;
	const nickname = message.member.nickname || username;

	let stats;
	if (args.length == 0) {
		stats = rankList[nickname.toLowerCase()] || rankList[username.toLowerCase()];
		if (!stats) {
			message.channel.send(`Unable to find ${nickname} or ${username}, please provide username explicitly like so: \`!rank username\``);
			return;
		}
	} else {
		const name = args[0].trim();
		stats = rankList[name.toLowerCase()];
		if (!stats) {
			message.channel.send(`Unable to find user ${args[0]}`);
			return;
		}
	}

	message.channel.send(formatRanking(stats));
}


client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

client.on("message", message => {
	if (message.content[0] != prefix) {
		return;
	}

	const args = message.content.slice(prefix.length).trim().split(" ");
	const command = args.shift().toLowerCase();

	if (command == "rank") {
		handleRankRequest(statsList, message, args);
	} else if (command == "oldrank") {
		handleRankRequest(oldStatsList, message, args);
	} else if (command == "help") {
		message.channel.send("Commands: `!rank`, `!oldrank`, `!help`");
	}
});

client.login(process.env.TOKEN);
