const Discord = require('discord.js');
const fs = require("fs/promises");
const client = new Discord.Client();
const statsPath = process.env.STATS;
const prefix = '!';

let statsList = null;

async function updateStats() {
	const content = (await fs.readFile(statsPath)).toString();

	statsList = {};

	const list = JSON.parse(JSON.parse(content).players);
	for (let key in list) {
		statsList[key.toLowerCase()] = list[key];
	}

	Object.values(statsList).sort((a, b) => b.score - a.score).forEach((stats, i) => {
		stats.place = i + 1;
	});
}


updateStats();
setInterval(updateStats, 30000);

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
		.setColor('#0099ff')
		.setTitle(`${stats.name}, ${ordinalSuffixOf(stats.place)}`)
		.setDescription(`${stats.name} is in ${ordinalSuffixOf(stats.place)} place, with ${Math.round(stats.score)} score.`)
		.addFields(fields)
		.setTimestamp();
}


client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', message => {
	if (message.content[0] != prefix) {
		return;
	}

	const args = message.content.slice(prefix.length).trim().split(' ');
	const command = args.shift().toLowerCase();

	if (command == "rank") {
		const username = message.author.username;
		const nickname = message.member.nickname || username;

		let stats;
		if (args.length == 0) {
			stats = statsList[nickname.toLowerCase()] || statsList[username.toLowerCase()];
			if (!stats) {
				message.channel.send(`Unable to find ${nickname} or ${username}, please provide username explicitly like so: \`!rank username\``);
				return;
			}
		} else {
			const name = args[0].trim();
			stats = statsList[name.toLowerCase()];
			if (!stats) {
				message.channel.send(`Unable to find user ${args[0]}`);
				return;
			}
		}

		message.channel.send(formatRanking(stats));
	}
});

client.login(process.env.TOKEN);
