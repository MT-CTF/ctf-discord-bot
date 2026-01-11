/// <reference path="./environment.d.ts" />
import * as Discord from "discord.js"
import * as redis from "redis"
import http from "http"
import "dotenv/config"
import * as process from "process"
import assert from "assert"
import fetch from 'node-fetch';

// Initialise Discord Client
// We set the ready state to true since functions use this client directly, even if it isn't ready until we call discordClient.login()
const discordClient: Discord.Client<true> = new Discord.Client({
	intents: [
		Discord.GatewayIntentBits.MessageContent
	]
})

interface redisStats {
	kills: number,
	kill_assists: number,
	deaths: number,
	score: number,
	bounty_kills: number,
	flag_captures: number,
	flag_attempts: number,
	hp_healed: number,
	reward_given_to_enemy: number,
}

const redisSTATKEYS: (keyof redisStats)[] = [
	"kills",
	"kill_assists",
	"deaths",
	"score",
	"bounty_kills",
	"flag_captures",
	"flag_attempts",
	"hp_healed",
	"reward_given_to_enemy",
]

/**
 * Object representing stats of a player for a specific game mode
 *
 * `name` and `place` can be placeholder values depending of where this object is used
 */
interface Stats extends redisStats { name: string, place: number };

interface GameApi {
	"current_map": {
		"name": string,
		"start_time": number,
		"technical_name": string
	},

	"current_mode": {
		"matches": number,
		"matches_played": number,
		"name": "classes" | "classic" | "nade_fight"
	},

	"player_info": {
		"count": number,
		"players": [string]
	}
}

// Read env variables
const host = process.env.HOST ? process.env.HOST : "127.0.0.1"
const redis_host = process.env.REDIS_HOST ? process.env.REDIS_HOST : "127.0.0.1"
const guildId = process.env.GUILD_ID
const rankingsChannel = process.env.RANKINGS_CHANNEL
const gameStatsChannel = process.env.GAME_STATS_CHANNEL
const token = process.env.TOKEN
const useRedis = process.env.USE_REDIS === undefined ? true : false


// Create the database client
const redisClient = redis.createClient({ socket: {host: redis_host} })

/**
 * Queue of ingame staff messages to be fetched by the Minetest server
 */
let staffMessages: string[] = []

/**
 * Stats of players in different modes
 *
 * Map of maps of player stats per mode
 *
 * eg: statsMap.get("mode_name").get("player_name")
 */
let statsMap: Map<string, Map<string, Stats>> | undefined = undefined

/**
 * List of players with stats in database, used for command autocompletion
 */
let statsPlayers: string[] | undefined = undefined

let lastUpdated = Date.now()

/**
 * Take an integer, return a string with the integer plus the ordinal suffix
 */
function ordinalSuffixOf(i: number): string {
	let j = i % 10, k = i % 100
	if (j == 1 && k != 11) {
		return i + "st"
	}
	if (j == 2 && k != 12) {
		return i + "nd"
	}
	if (j == 3 && k != 13) {
		return i + "rd"
	}
	return i + "th"
}

/**
 * Return a Discord Embed displaying the top 60 player stats
 * @param list Sorted list of player stats for the specified game mode, by score
 * @param mode Game Mode display name ex: "Classes"
 */
function formatLeaderboard(list: Stats[], mode: string): Discord.EmbedBuilder {
	const rows = 10
	const columns = 1
	const rankings_to = Math.min(50, Math.floor(25 / columns) * rows)

	const rankingsEmbed = new Discord.EmbedBuilder({
		color: Discord.Colors.Blue,
		description: "# Mode: " + mode + " `[1-" + rankings_to + "]`"
	})

	const max = Math.min(rankings_to, list.length)
	assert((max / rows) * 2 <= 25, "Discord embeds are limited to 25 fields. Tried: " + (1.5 * rankings_to) / columns)

	for (let i = 0; i < max; i += rows) {
		const from = i
		const to = i + rows

		const maxScore = Math.round(list[0].score).toLocaleString().length
		const newContent = "```ansi\n" + list
			.slice(from, to)
			.map((stats) => {
				let kd = stats.kills || 0
				kd /= stats.deaths || 1

				return [
					`[1;34m${stats.place.toString().padStart(2)}. [0;37m${stats.name.padEnd(18)}[0m | [1;36mScore: [0m${Math.round(stats.score).toLocaleString().padStart(maxScore)} | [2;36mK/D: [2;0m${kd.toFixed(1)}`,
				].join('\n')
			})
			.join("\n") + "```"
		try {
			rankingsEmbed.addFields(
				{ name: " ", value: newContent, inline: false },
			)
		} catch (error) {
			console.log(newContent.length)
			console.error(error)
		}
	}

	return rankingsEmbed.setFooter({ text: "Last Updated" }).setTimestamp(lastUpdated)
}


/**
 * Update the embeds containing the global leaderboard in the rankings channel
 * @param statsList Map of sorted player stats, indexed by game mode
 */
async function updateRankingsChannel(): Promise<void> {
	if (!rankingsChannel || statsMap === undefined) {
		return
	}

	const channel = await discordClient.channels.fetch(rankingsChannel) as Discord.TextChannel
	if (!channel || !channel.isTextBased()) {
		console.error("Rankings Channel doesn't exist or isn't text based")
		return
	}

	let rankings: Discord.EmbedBuilder[] = []
	for (const mode of [...statsMap.keys()].sort()) {
		rankings.push(formatLeaderboard(
			Array.from((<Map<string, Stats>>statsMap.get(mode)).values()),
			mode
		))
	}

	const messages = await channel.messages.fetch({ limit: rankings.length })
	if (messages.size < rankings.length) {
		for (let i = 0; i < rankings.length; ++i) {
			await channel.send({ embeds: [rankings[i]] })
		}
	} else {
		let it = messages.values()
		for (let i = 0; i < rankings.length; ++i) {
			let next = it.next()

			if (next && next.value) {
				await next.value.edit({
					embeds: [rankings[rankings.length - i - 1]]
				})
			} else {
				console.error("Invalid next for 'it': " + messages.values())
			}
		}
	}
}


/**
 * Get stats for a database key
 *
 * Create the Stats object and initialize all properties with default values
 *
 * `name` and `place` are set to placeholder values
 */
async function getStats(mode: string, pname: string): Promise<Stats> {
	let output: Stats = {
		name: pname,
		score: 0,
		kills: 0,
		kill_assists: 0,
		deaths: 0,
		bounty_kills: 0,
		flag_attempts: 0,
		flag_captures: 0,
		hp_healed: 0,
		reward_given_to_enemy: 0,
		place: Infinity,
	}

	let has_nonzero = false;

	await Promise.all(
		redisSTATKEYS.map(async (rank) => {
			let val = await redisClient.zScore(mode + "|" + rank, pname)

			if (val != null) {
				output[rank] = val;

				if (rank == "score") {
					let place = await redisClient.zRevRank(mode + "|" + rank, pname);

					output.place = (place !== null ? place : Infinity) + 1;
				}
			}
		})
	);

	return output;
}

/**
 * Return a mode title from a technical name
 *
 * eg: `nade_fight` -> `Nade Fight`
 */
function modeTechnicalToName(technical_name: string): string {
	return technical_name
		.split("_")
		.map((word) => {
			return word[0].toUpperCase() + word.substring(1)
		})
		.join(" ")
}

function getMapImage(map_name: string) {
	let url = "https://github.com/MT-CTF/maps/blob/master/"

	switch (map_name) {
		case "snow_globe":
			url = "https://github.com/MT-CTF/seasonal_xmas/blob/master/xmas_maps/maps/"
			break;
	}

	return (url + map_name);
}

//
async function updateGameStats(): Promise<void> {
	try {
		const response = await fetch("http://ctf.rubenwardy.com/api");

		const data = await (response.json() as Promise<GameApi>);

		if (!data) {
			console.error("Failed to fetch API data");
			return
		}

		const channel = await discordClient.channels.fetch(gameStatsChannel) as Discord.TextChannel
		if (!channel || !channel.isTextBased()) {
			console.error("Game Stats Channel doesn't exist or isn't text based")
			return
		}

		if (data.current_map) {
			var start_time = new Date(data.current_map.start_time * 1000);
			const embed = new Discord.EmbedBuilder({
				color: Discord.Colors.Blue,
				"title": data.current_map.name + " - " + modeTechnicalToName(data.current_mode.name),
				"description": "**Match**: " + data.current_mode.matches_played + "/" + data.current_mode.matches +
					"\n**Duration**: " + Math.round((Date.now() - start_time.getTime()) / 60000) + "m" +
					"\n**Players (" + data.player_info.count + ")**: " + Discord.escapeUnderline(Discord.escapeItalic(data.player_info.players.join(", "))),
			})

			embed.setFooter({ text: "Last Updated" }).setTimestamp(Date.now())
			embed.setImage(getMapImage(data.current_map.technical_name) + "/screenshot.png?raw=true")

			const messages = await channel.messages.fetch({ limit: 1 })
			const message = messages.last();
			if (message) {
				if (!message.author.bot) {
					await channel.send({ embeds: [embed] })
				} else {
					await message.edit({
						embeds: [
							embed
						]
					})
				}
			}
		}
	} catch (error) {
		console.log(error);
	}
}


/**
 * Update ranking data cache, trigger update of rankings channel
 */
async function updateRankings(): Promise<void> {
	let newStats: Map<string, Map<string, Stats>> = new Map()
	statsPlayers = []

	await Promise.all((["ctf_mode_classes", "ctf_mode_classic", "ctf_mode_nade_fight"]).map(async (modetech) => {
		// { score: <amount of given rank, which in this case is ctf score (derived from "|score")>, value: <playername> }
		let ranks = await redisClient.zRangeWithScores(modetech + "|score", 0, -1, { REV: true })

		let mode = modeTechnicalToName(modetech);

		if (newStats.get(mode) === undefined) {
			newStats.set(mode, new Map())
		}

		await Promise.all(ranks.map(async (vals, place) => {
			let stats = await getStats(modetech, vals.value);

			(<Map<string, Stats>>newStats.get(mode)).set(vals.value, stats);
			(statsPlayers as Array<string>).push(vals.value);
		}))
	}))

	statsMap = newStats;

	statsPlayers = [...new Set(statsPlayers)]
	statsPlayers.sort()

	lastUpdated = Date.now()

	await updateRankingsChannel()
}

function formatRanking(stats: Stats, mode: string, mostscore: number) {
	let kd = stats.kills / (stats.deaths || 1)

	let score_per_kill = stats.score / (stats.kills || 1)
	const pad_amount = Math.max(kd * 100, Math.pow(10, Math.round(mostscore).toLocaleString().toString().length), Math.round(stats.kill_assists), Math.round(stats.bounty_kills)).toString().length

	const content = [
		"```ansi",
		"[1;36mScore:       [1;37m" + Math.round(stats.score).toLocaleString().toString().padStart(pad_amount) + "[0m",
		"[1;36mKills:       [0m" + Math.round(stats.kills).toString().padStart(pad_amount),
		"[1;36mHP Healed:   [0m" + Math.round(stats.hp_healed).toString().padStart(pad_amount),
		"[1;36mKill Assists: [0m" + Math.round(stats.kill_assists).toString().padStart(pad_amount - 1),
		"[1;36mDeaths:      [0m" + Math.round(stats.deaths).toString().padStart(pad_amount),
		"[1;36mBounty Kills: [0m" + Math.round(stats.bounty_kills).toString().padStart(pad_amount - 1),
		"[1;36mCaptures:    [0m" + Math.round(stats.flag_captures).toString().padStart(pad_amount),
		"[1;36mAttempts:    [0m" + Math.round(stats.flag_attempts).toString().padStart(pad_amount),
		"[2;36mK/D:         [0m" + kd.toFixed(1).toString().padStart(pad_amount),
		"[2;36mScore/Kill:  [0m" + Math.round(score_per_kill).toString().padStart(pad_amount),
		"```",
	].join("\n")

	return { name: `${mode}: ${Discord.inlineCode(ordinalSuffixOf(stats.place))}`, value: content, inline: true }
}

// Old version with more row-like structure for stats. Kept in case of future reimplementation
//
// function formatRanking(stats: Stats, mode: string) {
// 	let kd = stats.kills / (stats.deaths || 1)

// 	let score_per_kill = stats.score / (stats.kills || 1)
// 	const pad_amount_c1 = Math.max(Math.round(stats.score).toString().toLocaleString().length, Math.round(stats.kills), Math.round(stats.deaths)).toString().length + 1
// 	const pad_amount_c2 = Math.max(Math.round(stats.kill_assists), Math.round(stats.bounty_kills), Math.round(stats.flag_attempts), Math.round(stats.hp_healed)).toString().length

// 	const content = [
// 		"```ansi",
// 		"[1;36mScore:    [1;37m" + Math.round(stats.score).toString().toLocaleString().padStart(pad_amount_c1) +
// 		"[0m | [1;36mHP Healed:    [0m" + Math.round(stats.hp_healed).toString().padStart(pad_amount_c2),
// 		"[1;36mKills:    [0m" + Math.round(stats.kills).toString().padStart(pad_amount_c1) +
// 		" | [1;36mKill Assists: [0m" + Math.round(stats.kill_assists).toString().padStart(pad_amount_c2),
// 		"[1;36mDeaths:   [0m" + Math.round(stats.deaths).toString().padStart(pad_amount_c1) +
// 		" | [1;36mBounty Kills: [0m" + Math.round(stats.bounty_kills).toString().padStart(pad_amount_c2),
// 		"[1;36mCaptures: [0m" + Math.round(stats.flag_captures).toString().padStart(pad_amount_c1) +
// 		" | [1;36mAttempts:     [0m" + Math.round(stats.flag_attempts).toString().padStart(pad_amount_c2),
// 		"[1;34mK/D: [0m" + kd.toFixed(1) +
// 		" | [1;34m~Score/Kill: [0m" + Math.round(score_per_kill).toString(),
// 		"```",
// 	].join("\n")

// 	return new Discord.EmbedBuilder({
// 		color: (stats.place <= 20 || stats.place == 1337) ? Discord.Colors.Gold : Discord.Colors.Blue,
// 		title: `${stats.name}: ${Discord.inlineCode(ordinalSuffixOf(stats.place))} [${mode}]`,
// 		description: content,
// 	})
// }

const error_embed_admin_mute = new Discord.EmbedBuilder({
	color: Discord.Colors.Red,
	description: "The user you are trying to mute is a staff member!"
})

const error_embed_bot_mute = new Discord.EmbedBuilder({
	color: Discord.Colors.Red,
	description: "No. You can't do that."
})

const error_embed_stats_unavaillable = new Discord.EmbedBuilder({
	color: Discord.Colors.Red,
	description: "Please wait, stats are still loading..."
})

let embed_leaders = new Discord.EmbedBuilder({ color: Discord.Colors.Blue })
if (rankingsChannel) {
	embed_leaders = embed_leaders.setDescription(`Check out <#${rankingsChannel}>`)
} else {
	embed_leaders = embed_leaders.setDescription("There is no rankings channel")
}

// commands definition

const commands: (Discord.SlashCommandOptionsOnlyBuilder)[] = []

commands.push(
	new Discord.SlashCommandBuilder()
		.setName("rank")
		.setDescription("Shows ingame rankings")
		.addStringOption((option) =>
			option
				.setName("player")
				.setDescription("The player")
				.setAutocomplete(true)
		)
)

commands.push(
	new Discord.SlashCommandBuilder()
		.setName("x")
		.setDescription("Send messages on staff channel")
		.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.KickMembers)
		.addStringOption((option) =>
			option
				.setName("message")
				.setDescription("Enter message")
				.setRequired(true)
		)
)

commands.push(
	new Discord.SlashCommandBuilder()
		.setName("leaders")
		.setDescription(
			"Shows the top 60 leaderboard or links to the dedicated channel for it"
		)
)

commands.push(
	new Discord.SlashCommandBuilder()
		.setName("mute")
		.setDescription("Mutes a user")
		.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.KickMembers)
		.addUserOption((option) =>
			option.setName("user").setDescription("User to mute").setRequired(true)
		)
)

commands.push(
	new Discord.SlashCommandBuilder()
		.setName("unmute")
		.setDescription("Unmutes a user")
		.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.KickMembers)
		.addUserOption((option) =>
			option.setName("user").setDescription("User to unmute").setRequired(true)
		)
)

discordClient.on(Discord.Events.ClientReady, () => {
	console.log(`Logged in as ${discordClient.user.tag}`)

	const guild = discordClient.guilds.resolve(guildId)

	// Push commands to guild
	if (guild) {
		guild.commands.set(commands).catch(console.error)
	} else {
		console.error("Cannot resolve guild from guild id")
	}
})

discordClient.on(Discord.Events.InteractionCreate, async (interaction) => {
	// Handle autocomplete for `rank` command
	if (interaction.isAutocomplete()) {
		if (interaction.commandName === "rank") {
			if (!statsPlayers) {
				interaction.respond([])
				return
			}
			const focusedValue = interaction.options.getFocused().toLowerCase()
			const filtered = statsPlayers.filter((p) =>
				p.toLowerCase().startsWith(focusedValue)
			)
			await interaction.respond(
				filtered.slice(0, 10).map((p) => ({ name: p, value: p }))
			)
		}
	} else if (interaction.isChatInputCommand()) {
		const { commandName, options } = interaction
		const member = <Discord.GuildMember>interaction.member

		// Reject interactions outside of a guild (would crash the bot)
		if (!interaction.guild) {
			return
		}

		// Handle Commands
		if (commandName === "rank") {
			if (!statsMap) {
				interaction.reply({
					embeds: [error_embed_stats_unavaillable],
					ephemeral: true
				})
				return
			}

			const option_player = options.getString("player")?.trim()
			if (option_player) {
				let playerStats: [Stats, string][] = []

				for (const mode of [...statsMap.keys()].sort()) {
					let mode_stats = <NonNullable<Map<string, Stats>>>statsMap.get(mode)
					let stat = mode_stats.get(option_player)
					if (stat) {
						playerStats.push([stat, mode])
					}
				}

				if (playerStats.length > 0) {
					let embeds: Discord.EmbedBuilder[] = []
					let embed = new Discord.EmbedBuilder({
						color: Math.min(playerStats[0][0].place, playerStats[1][0].place, playerStats[2][0].place) <= 20 ? Discord.Colors.Gold : Discord.Colors.Blue,
						description: `## Rankings of ${playerStats[0][0].name}`
					})

					let mcount = 0;
					for (const [stat, mode] of playerStats) {
						embed.addFields(formatRanking(stat, mode, Math.max(playerStats[0][0].score, playerStats[1][0].score, playerStats[2][0].score)))

						if (++mcount % 2 == 0)
							embed.addFields({ name: " ", value: " ", inline: false })
					}

					if (mcount % 2 != 0)
						embed.addFields({ name: " ", value: " ", inline: true })

					embeds.push(embed.setFooter({ text: "Last Updated" }).setTimestamp(lastUpdated))

					interaction.reply({ embeds: embeds, ephemeral: false })
				} else {
					interaction.reply({
						embeds: [
							new Discord.EmbedBuilder({
								color: Discord.Colors.Red,
								description: `Unable to find ${option_player}.`
							})
						],
						ephemeral: false
					})
				}
			} else {
				const guildNickname = member.nickname
				const globalDisplayName = member.user.globalName
				const username = member.user.username

				let playerStats: [Stats, string][] = []

				for (const mode of [...statsMap.keys()].sort()) {
					let mode_stats = <NonNullable<Map<string, Stats>>>statsMap.get(mode)
					let stat: Stats | undefined

					// First try with the user server nick name
					if (guildNickname) {
						stat = mode_stats.get(guildNickname.trim())
					}

					// Try with the global display name
					if (globalDisplayName && !stat) {
						stat = mode_stats.get(globalDisplayName.trim())
					}

					// If no stats, try with the username
					if (!stat) {
						stat = mode_stats.get(username.trim())
					}

					if (stat) {
						playerStats.push([stat, mode])
					}
				}

				if (playerStats.length > 0) {
					let embeds: Discord.EmbedBuilder[] = []
					let embed = new Discord.EmbedBuilder({
						color: Math.min(playerStats[0][0].place, playerStats[1][0].place, playerStats[2][0].place) <= 20 ? Discord.Colors.Gold : Discord.Colors.Blue,
						description: `## Rankings of ${playerStats[0][0].name}`
					})

					let mcount = 0;
					for (const [stat, mode] of playerStats) {
						embed.addFields(formatRanking(stat, mode, Math.max(playerStats[0][0].score, playerStats[1][0].score, playerStats[2][0].score)))

						if (++mcount % 2 == 0)
							embed.addFields({ name: " ", value: " ", inline: false })
					}

					if (mcount % 2 != 0)
						embed.addFields({ name: " ", value: " ", inline: true })

					embeds.push(embed.setFooter({ text: "Last Updated" }).setTimestamp(lastUpdated))

					interaction.reply({ embeds: embeds, ephemeral: false })
				} else {
					if (guildNickname && username.trim() != guildNickname.trim()) {
						if (globalDisplayName && globalDisplayName.trim() != guildNickname.trim()) {
							interaction.reply({
								embeds: [
									new Discord.EmbedBuilder({
										color: Discord.Colors.Red,
										description: `Unable to find ${guildNickname}, ${globalDisplayName} or ${username}, please provide username explicitly.`
									})
								],
								ephemeral: false
							})
						} else {
							interaction.reply({
								embeds: [
									new Discord.EmbedBuilder({
										color: Discord.Colors.Red,
										description: `Unable to find ${guildNickname} or ${username}, please provide username explicitly.`
									})
								],
								ephemeral: false
							})
						}
					} else {
						interaction.reply({
							embeds: [
								new Discord.EmbedBuilder({
									color: Discord.Colors.Red,
									description: `Unable to find ${username}, please provide username explicitly.`
								})
							],
							ephemeral: false
						})
					}
				}
			}
		} else if (commandName === "x") {
			const guildNickname = member.nickname
			const globalDisplayName = member.user.globalName
			const username = member.user.username

			const name = (guildNickname ? guildNickname : (globalDisplayName ? globalDisplayName : username)).replace(/[^a-zA-Z0-9_-]/g, "")

			staffMessages.push(
				`<${name}@Discord> ${options.getString("message")}`
			)

			interaction.reply({
				embeds: [
					new Discord.EmbedBuilder({
						color: Discord.Colors.Blue,
						description: `**${name}**: ${options.getString("message")}`
					})
				],
				ephemeral: false
			})
		} else if (commandName === "leaders") {
			interaction.reply({ embeds: [embed_leaders], ephemeral: true })
		} else if (commandName === "mute") {
			const muted_member = <Discord.GuildMember>options.getMember("user")

			let muterole = interaction.guild.roles.cache.find(
				(role) => role.name === "Muterated"
			)

			if (!muterole) {
				console.error("Could not find \"Muterated\" role in guild")
				return
			}

			if (discordClient.user.id === muted_member.user.id) {
				interaction.reply({
					embeds: [error_embed_bot_mute],
					ephemeral: true
				})
			} else if (
				muted_member.permissions.has(
					Discord.PermissionsBitField.Flags.KickMembers
				)
			) {
				interaction.reply({
					embeds: [error_embed_admin_mute],
					ephemeral: true
				})
			} else {
				await muted_member.roles.add(muterole.id)
				interaction.reply({
					embeds: [
						new Discord.EmbedBuilder({
							color: Discord.Colors.Blue,
							description: `**${muted_member.user.username}** has been muted.`
						})
					],
					ephemeral: false
				})
			}
		} else if (commandName === "unmute") {
			const muted_member = <Discord.GuildMember>options.getMember("user")

			let muterole = interaction.guild.roles.cache.find(
				(role) => role.name === "Muterated"
			)

			if (!muterole) {
				console.error("Could not find \"Muterated\" role in guild")
				return
			}

			await muted_member.roles.remove(muterole.id)
			interaction.reply({
				embeds: [
					new Discord.EmbedBuilder({
						color: Discord.Colors.Blue,
						description: `**${muted_member.user.username}** has been unmuted.`
					})
				],
				ephemeral: false
			})
		}
	}
})

async function main() {
	// Connect to Discord and the database
	await discordClient.login(token)

	if (useRedis) {
		await redisClient.connect()

		await updateRankings()
		// Update the rankings cache every 5m
		setInterval(updateRankings, 1000 * 60 * 5)
	}

	if (gameStatsChannel) {
		await updateGameStats()
		// Update the game stats every 30s
		setInterval(updateGameStats, 1000 * 30)
	}

	http.createServer(function (req, res) {
		if (req.method === "GET" && staffMessages.length > 0) {
			console.log("Relaying staff messages: " + staffMessages.join("-|-"))

			// Write responce
			res.writeHead(200, { "Content-Type": "text/plain" })
			res.write(JSON.stringify(staffMessages))

			staffMessages = []
		} else {
			res.writeHead(200)
		}
		res.end()
	}).listen(31337, host)
}

await main()
