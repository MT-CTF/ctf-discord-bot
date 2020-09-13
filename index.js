import { Client } from 'discord.js';
import { readFile } from "fs/promises";
const client = new Client();
const statsPath = process.env.STATS;
const prefix = '!';

let statsList = null;

async function updateStats() {
	const content = (await readFile(statsPath)).toString();

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


function formatRanking(stats) {
	let kd = stats.kills;
	if (stats.deaths > 1) {
		kd /= stats.deaths;
	}

	return `${stats.name} is in ${stats.place} place, with ${Math.round(stats.score)} score.\n` +
			`Kills: ${stats.kills} | Deaths: ${stats.deaths} | K/D: ${kd.toFixed(1)}\n` +
			`Bounty kills: ${stats.bounty_kills} | Captures: ${stats.captures} | Attempts: ${stats.attempts}`;
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
		let stats;
		if (args.length == 0) {
			stats = statsList[message.member.nickname.toLowerCase()] || statsList[message.author.username.toLowerCase()];
			if (!stats) {
				message.channel.send(`Unable to find ${message.member.nickname} or ${message.author.username}, please provide it explicitly like so: !rank username`);
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
