/// <reference path="./environment.d.ts" />
import Discord from "discord.js"
import * as redis from "redis"
import http from "http"
import "dotenv/config"
import * as process from "process"

// Initialise Discord Client
// We set the ready state to true since functions use this client directly, even if it isn't ready until we call discordClient.login()
const discordClient: Discord.Client<true> = new Discord.Client({
	intents: [
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.GuildIntegrations
	]
})

/**
 * Object representing stats of a player for a specific game mode
 *
 * `name` and `place` can be placeholder values depending of where this object is used
 */
type Stats = {
	/**
	 * The name of the player, initialised from the database key
	 */
	name: string,
	kills: number,
	deaths: number,
	score: number,
	bounty_kills: number,
	flag_captures: number,
	flag_attempts: number,
	hp_healed: number,
	/**
	 * Set after sorting a list of stats to the index in the list
	 */
	place: number,
}

// Create the database client
const redisClient = redis.createClient()

// Read env variables
const guildId = process.env.GUILD_ID
const rankingsChannel = process.env.RANKINGS_CHANNEL
const token = process.env.TOKEN

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


/**
 * Return a Discord Embed displaying the top 60 player stats
 * @param list Sorted list of player stats for the specified game mode, by score
 * @param mode Game Mode display name ex: "Classes"
 */
function formatLeaderboard(list: Stats[], mode: string): Discord.EmbedBuilder {
	const rankingsEmbed = new Discord.EmbedBuilder({
		color: Discord.Colors.Blue,
		title: "CTF Rankings for mode " + mode
	})

	const max = Math.min(60, list.length)
	for (let i = 0; i < max; i += 20) {
		const from = i
		const to = i + 20

		const newContent = list
			.slice(from, to)
			.map((stats) => {
				let kd = stats.kills || 0
				kd /= stats.deaths || 1

				stats.name = stats.name.replace("_", "\\_")

				return `**${stats.place}. ${stats.name}**\nK/D: ${kd.toFixed(
					1
				)} - Score: *${Math.round(stats.score)}*`
			})
			.join("\n")

		rankingsEmbed.addFields([
			{ name: `__Top ${from + 1} - ${to}__`, value: newContent }
		])
	}

	return rankingsEmbed
}


/**
 * Update the embeds containing the global leaderboard in the rankings channel
 * @param statsList Map of sorted player stats, indexed by game mode
 */
async function updateRankingsChannel(statsList: Map<string, Stats[]>): Promise<void> {
	if (!rankingsChannel) {
		return
	}

	const channel = discordClient.channels.cache.get(rankingsChannel)
	if (!channel || !channel.isTextBased()) {
		console.error("Rankings Channel doesn't exist or isn't text based")
		return
	}

	let rankings: Discord.EmbedBuilder[] = []
	for (const mode of [...statsList.keys()].sort()) {
		rankings.push(formatLeaderboard(<Stats[]>statsList.get(mode), mode))
	}

	const messages = await channel.messages.fetch({ limit: rankings.length })
	if (messages.size < rankings.length) {
		for (let i = 0; i < rankings.length; ++i) {
			await channel.send({ embeds: [rankings[i]] })
		}
	} else {
		let it = messages.values()
		for (let i = 0; i < rankings.length; ++i) {
			await it.next().value.edit({
				embeds: [rankings[rankings.length - i - 1]]
			})
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
async function getStats(key: string): Promise<Stats> {
	let result = JSON.parse(<string>await redisClient.get(key))
	return {
		name: "",
		score: result.score || 0,
		kills: result.kills || 0,
		deaths: result.deaths || 0,
		bounty_kills: result.bounty_kills || 0,
		flag_attempts: result.flag_attempts || 0,
		flag_captures: result.flag_captures || 0,
		hp_healed: result.hp_healed || 0,
		place: NaN
	}
}

/**
 * Return a mode title from a technical name
 *
 * eg: `nade_fight` -> `Nade Fight`
 */
function modeTechnicalToName(technical_name: string): string {
	return technical_name
		.substring(9)
		.split("_")
		.map((word) => {
			return word[0].toUpperCase() + word.substring(1)
		})
		.join(" ")
}


/**
 * Update ranking data cache, trigger update of rankings channel
 */
async function updateRankings(): Promise<void> {
	const statsList: Map<string, Stats[]> = new Map()
	statsPlayers = []
	for (const key of await redisClient.keys("ctf_mode_*")) {
		// Determine the mode and the player name from the key
		const [rawMode, name] = key.split("|", 2)
		const mode = modeTechnicalToName(rawMode)

		// Get stats for the key
		let stats = await getStats(key)

		if (stats) {
			// Set player name from the key
			stats.name = name

			// Initialize the ranking array
			if (statsList.get(mode) === undefined) {
				statsList.set(mode, [])
			}

			(<Stats[]>statsList.get(mode)).push(stats)
		}
		statsPlayers.push(name)
	}

	statsMap = new Map()

	for (const [mode, stats] of statsList) {
		stats.sort((a, b) => b.score - a.score)
		stats.forEach((stat, i) => {
			stat.place = i + 1
		})

		statsMap.set(mode, new Map())
		for (const stat of stats) {
			(<Map<string, Stats>>statsMap.get(mode)).set(stat.name.toLowerCase(), stat)
		}
	}

	statsPlayers = [...new Set(statsPlayers)]
	statsPlayers.sort()

	await updateRankingsChannel(statsList)
}

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

function formatRanking(stats: Stats, mode: string) {
	let kd = stats.kills / (stats.deaths || 1)

	let score_per_kill = stats.score / (stats.kills || 1)

	const fields: Discord.APIEmbedField[] = [
		{ name: "Kills", value: Math.round(stats.kills).toString(), inline: true },
		{ name: "Deaths", value: Math.round(stats.deaths).toString(), inline: true },
		{ name: "K/D", value: kd.toFixed(1), inline: true },
		{
			name: "Bounty kills",
			value: Math.round(stats.bounty_kills).toString(),
			inline: true
		},
		{
			name: "Captures",
			value: Math.round(stats.flag_captures).toString(),
			inline: true
		},
		{
			name: "HP healed",
			value: Math.round(stats.hp_healed).toString(),
			inline: true
		},
		{
			name: "Avg. score/kill",
			value: Math.round(score_per_kill).toString(),
			inline: true
		}
	]

	return new Discord.EmbedBuilder({
		color: Discord.Colors.Blue,
		title: `${stats.name}, ${ordinalSuffixOf(stats.place)}, ${mode}`,
		description: `${stats.name} is in ${ordinalSuffixOf(
			stats.place
		)} place, with ${Math.round(stats.score)} score, ${mode} mode.`,
		fields: fields
	})
}

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
	embed_leaders = embed_leaders.setDescription(`Checkout <#${rankingsChannel}>`)
} else {
	embed_leaders = embed_leaders.setDescription("There is no rankings channel")
}

// commands definition

const commands: Omit<Discord.SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">[] = []

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

			const option_player = options.getString("player")
			if (option_player) {
				let playerStats: [Stats, string][] = []

				for (const mode of [...statsMap.keys()].sort()) {
					let mode_stats = <NonNullable<Map<string, Stats>>>statsMap.get(mode)
					let stat = mode_stats.get(option_player.toLowerCase())
					if (stat) {
						playerStats.push([stat, mode])
					}
				}

				if (playerStats.length > 0) {
					let embeds: Discord.EmbedBuilder[] = []
					for (const [stat, mode] of playerStats) {
						embeds.push(formatRanking(stat, mode))
					}

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
						stat = mode_stats.get(guildNickname.trim().toLowerCase())
					}

					// Try with the global display name
					if (globalDisplayName && !stat) {
						stat = mode_stats.get(globalDisplayName.trim().toLowerCase())
					}
					
					// If no stats, try with the username
					if (!stat) {
						stat = mode_stats.get(username.trim().toLowerCase())
					}

					if (stat) {
						playerStats.push([stat, mode])
					}
				}

				if (playerStats.length > 0) {
					let embeds: Discord.EmbedBuilder[] = []
					for (const [stat, mode] of playerStats) {
						embeds.push(formatRanking(stat, mode))
					}

					interaction.reply({ embeds: embeds, ephemeral: false })
				} else {
					if (guildNickname && username.trim().toLowerCase() != guildNickname.trim().toLowerCase()) {
						if (globalDisplayName && globalDisplayName.trim().toLowerCase() != guildNickname.trim().toLowerCase()) {
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
			// TODO: Use member's displayName?
			staffMessages.push(
				`<${member.user.username}@Discord> ${options.getString("message")}`
			)

			interaction.reply({
				embeds: [
					new Discord.EmbedBuilder({
						color: Discord.Colors.Blue,
						description: `**${member.user.username}**: ${options.getString("message")}`
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
	await redisClient.connect()

	// Update the rankings cache every 6s
	await updateRankings()
	setInterval(updateRankings, 6000)

	// prettier-ignore
	http.createServer(function(req, res) {
		if (req.method === "GET" && staffMessages.length > 0) {
			res.writeHead(200, { "Content-Type": "text/plain" })
			console.log("Relaying staff messages: " + staffMessages.join("-|-"))
			res.write(JSON.stringify(staffMessages))
			staffMessages = []
		}

		res.writeHead(200)
		res.end()
	})
		.listen(31337, "127.0.0.1")
}

await main()
