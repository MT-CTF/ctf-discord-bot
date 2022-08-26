import Discord from "discord.js"
import redis from "redis"
import http from "http"
import "dotenv/config"

const discordClient = new Discord.Client({
	intents: [
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.GuildIntegrations,
	],
})

const redisClient = redis.createClient({ url: "redis://localhost:6380" })

const guildId = process.env.GUILD_ID
const rankingsChannel = process.env.RANKINGS_CHANNEL
const token = process.env.TOKEN

const prefix = "!"

let staffMessages = []
let statsMap = null
let statsPlayers = null

function formatLeaderboard(list, mode) {
	const rankingsEmbed = new Discord.EmbedBuilder()
		.setColor("#0099ff")
		.setTitle("CTF Rankings for mode " + mode)

	const max = Math.min(60, list.length)
	for (var i = 0; i < max; i += 20) {
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
			{ name: `__Top ${from + 1} - ${to}__`, value: newContent },
		])
	}

	return rankingsEmbed
}

async function updateRankingsChannel(statsList) {
	if (!rankingsChannel) {
		return
	}

	const channel = discordClient.channels.cache.get(rankingsChannel)
	if (!channel) {
		return
	}

	let rankings = []
	for (const mode of [...statsList.keys()].sort()) {
		rankings.push(formatLeaderboard(statsList.get(mode), mode))
	}

	const messages = await channel.messages.fetch({ limit: rankings.length })
	if (messages.size < rankings.length) {
		for (var i = 0; i < rankings.length; ++i) {
			await channel.send({ embeds: [rankings[i]], ephemeral: false })
		}
	} else {
		let it = messages.values()
		for (var i = 0; i < rankings.length; ++i) {
			await it.next().value.edit({
				embeds: [rankings[rankings.length - i - 1]],
				ephemeral: false,
			})
		}
	}
}

async function updateRankings() {
	let statsList = new Map()
	statsPlayers = []
	for (const key of await redisClient.keys("ctf_mode_*")) {
		const [rawMode, name] = key.split("|", 2)
		const mode = rawMode
			.substring(9)
			.split("_")
			.map((word) => {
				return word[0].toUpperCase() + word.substring(1)
			})
			.join(" ")

		let stats = JSON.parse(await redisClient.get(key))

		if (stats) {
			stats["name"] = name
			stats.score = stats.score || 0

			if (statsList.get(mode) === undefined) {
				statsList.set(mode, [])
			}

			statsList.get(mode).push(stats)
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
			statsMap.get(mode).set(stat.name.toLowerCase(), stat)
		}
	}

	await updateRankingsChannel(statsList)
	statsPlayers.sort()
}

function ordinalSuffixOf(i) {
	var j = i % 10,
		k = i % 100
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

function normValue(v) {
	return Math.round(v || 0)
}

function formatRanking(stats, mode) {
	let kd = stats.kills || 0
	kd /= stats.deaths || 1

	const fields = [
		{ name: "Kills", value: normValue(stats.kills).toString(), inline: true },
		{ name: "Deaths", value: normValue(stats.deaths).toString(), inline: true },
		{ name: "K/D", value: kd.toFixed(1), inline: true },
		{
			name: "Bounty kills",
			value: normValue(stats.bounty_kills).toString(),
			inline: true,
		},
		{
			name: "Captures",
			value: normValue(stats.flag_captures).toString(),
			inline: true,
		},
		{
			name: "HP healed",
			value: normValue(stats.hp_healed).toString(),
			inline: true,
		},
	]

	return new Discord.EmbedBuilder()
		.setColor("#0099ff")
		.setTitle(`${stats.name}, ${ordinalSuffixOf(stats.place)}, ${mode}`)
		.setDescription(
			`${stats.name} is in ${ordinalSuffixOf(
				stats.place
			)} place, with ${Math.round(stats.score)} score, ${mode} mode.`
		)
		.setFields(fields)
		.setTimestamp()
}

const error_embed_admin_mute = new Discord.EmbedBuilder()
	.setColor(Discord.Colors.Red)
	.setDescription("The user you are trying to mute is a staff member!")

const error_embed_bot_mute = new Discord.EmbedBuilder()
	.setColor(Discord.Colors.Red)
	.setDescription("No. You can't do that.")

const error_embed_stats_unavaillable = new Discord.EmbedBuilder()
	.setColor(Discord.Colors.Red)
	.setDescription("Please wait, stats are still loading...")

let embed_leaders = new Discord.EmbedBuilder().setColor(Discord.Colors.Blue)
if (rankingsChannel) {
	embed_leaders = embed_leaders.setDescription(`Checkout <#${rankingsChannel}>`)
} else {
	embed_leaders = embed_leaders.setDescription("There is no rankings channel")
}

// commands definition

const commands = []

//fixme
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

discordClient.on("ready", () => {
	console.log(`Logged in as ${discordClient.user.tag}`)

	const guild = discordClient.guilds.resolve(guildId)

	//push commands to server
	guild.commands.set(commands).catch(console.error)
})

discordClient.on("interactionCreate", async (interaction) => {
	if (
		interaction.type === Discord.InteractionType.ApplicationCommandAutocomplete
	) {
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
	} else if (interaction.isCommand()) {
		const { commandName, member, memberPermissions, options } = interaction

		//handle commands
		if (commandName === "rank") {
			if (!statsMap) {
				interaction.reply({
					embeds: [error_embed_stats_unavaillable],
					ephemeral: true,
				})
			}

			const option_player = options.getString("player")
			if (option_player) {
				let playerStats = []

				for (const mode of [...statsMap.keys()].sort()) {
					let stat = statsMap.get(mode).get(option_player.toLowerCase())
					if (stat) {
						playerStats.push([stat, mode])
					}
				}

				if (playerStats.length > 0) {
					let embeds = []
					for (const [stat, mode] of playerStats) {
						embeds.push(formatRanking(stat, mode))
						interaction.reply({ embeds: embeds, ephemeral: false })
					}
				} else {
					interaction.reply({
						embeds: [
							new Discord.EmbedBuilder()
								.setColor(Discord.Colors.Red)
								.setDescription(`Unable to find ${option_player}.`),
						],
						ephemeral: false,
					})
				}
			} else {
				const username = member.user.username.trim()
				const nickname = member.nickname
				const name = nickname ? nickname : username

				let playerStats = []

				for (const mode of [...statsMap.keys()].sort()) {
					let stat = statsMap.get(mode).get(name.toLowerCase())
					if (!stat) {
						stat = statsMap.get(mode).get(username.toLowerCase())
					}
					if (stat) {
						playerStats.push([stat, mode])
					}
				}

				if (playerStats.length > 0) {
					let embeds = []
					for (const [stat, mode] of playerStats) {
						embeds.push(formatRanking(stat, mode))
						interaction.reply({ embeds: embeds, ephemeral: false })
					}
				} else {
					if (username.toLowerCase() != name.toLowerCase()) {
						interaction.reply({
							embeds: [
								new Discord.EmbedBuilder()
									.setColor(Discord.Colors.Red)
									.setDescription(
										`Unable to find ${nickname} or ${username}, please provide username explicitly.`
									),
							],
							ephemeral: false,
						})
					} else {
						interaction.reply({
							embeds: [
								new Discord.EmbedBuilder()
									.setColor(Discord.Colors.Red)
									.setDescription(
										`Unable to find ${nickname}, please provide username explicitly.`
									),
							],
							ephemeral: false,
						})
					}
				}
			}
		} else if (commandName === "x") {
			staffMessages.push(
				`<${member.user.username}@Discord> ${options.getString("message")}`
			)

			interaction.reply({
				embeds: [
					new Discord.EmbedBuilder()
						.setColor(Discord.Colors.Blue)
						.setDescription(
							`**${member.user.username}**: ${options.getString("message")}`
						),
				],
				ephemeral: false,
			})
		} else if (commandName === "leaders") {
			await interaction.reply({ embeds: [embed_leaders], ephemeral: true })
		} else if (commandName === "mute") {
			const muted_member = options.getMember("user")

			let muterole = interaction.guild.roles.cache.find(
				(role) => role.name === "Muterated"
			)

			if (discordClient.user.id === muted_member.user.id) {
				interaction.reply({
					embeds: [error_embed_bot_mute],
					ephemeral: true,
				})
			} else if (
				muted_member.permissions.has(
					Discord.PermissionsBitField.Flags.KickMembers
				)
			) {
				interaction.reply({
					embeds: [error_embed_admin_mute],
					ephemeral: true,
				})
			} else {
				await muted_member.roles.add(muterole.id)
				interaction.reply({
					embeds: [
						new Discord.EmbedBuilder()
							.setColor(Discord.Colors.Blue)
							.setDescription(
								`**${muted_member.user.username}** has been muted.`
							),
					],
					ephemeral: false,
				})
			}
		} else if (commandName === "unmute") {
			const muted_member = options.getMember("user")

			let muterole = interaction.guild.roles.cache.find(
				(role) => role.name === "Muterated"
			)

			await muted_member.roles.remove(muterole.id)
			interaction.reply({
				embeds: [
					new Discord.EmbedBuilder()
						.setColor(Discord.Colors.Blue)
						.setDescription(
							`**${muted_member.user.username}** has been unmuted.`
						),
				],
				ephemeral: false,
			})
		}
	}
})

async function main() {
	await discordClient.login(token)
	await redisClient.connect()

	await updateRankings()
	setInterval(updateRankings, 6000)

	http
		.createServer(function (req, res) {
			if (req.method == "GET" && staffMessages.length > 0) {
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
main()
