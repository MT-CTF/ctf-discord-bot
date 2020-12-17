# CTF Discord Bot

Requires Node v14.

License: MIT

## Features

* Show rank stats embed for a player.
  * `!rank` - Stats for player with the Discord user's username or nickname.
  * `!rank username` - Stats for player `username`.
  * `!oldrank` - Old stats for player with the Discord user's username or nickname.
  * `!oldrank username` - Old stats for player `username`.
* Posts leaderboard to a channel, editing existing messages.

## Usage

* Create Discord bot and application using the [Discord Developer Portal](https://discord.com/developers/applications/),
  as shown in [this guide](https://discordjs.guide/preparations/setting-up-a-bot-application.html#creating-your-bot).
* Invite the Discord bot to the desired server, as shown in
  [this guide](https://discordjs.guide/preparations/adding-your-bot-to-servers.html#bot-invite-links).
* Install dependencies: `npm install`.
* Run with environment variables: `RANKINGS_CHANNEL=id STATS=path/to/ctf_stats OLD_STATS=path/to/ctf_stats.old TOKEN=discord_token npm start`
  * `RANKINGS_CHANNEL` - Channel ID for the leaderboard.
  * `STATS` - Path to stats file, found in `world/ctf/mod_storage/ctf_stats`.
  * `OLD_STATS` - Path to old stats file (!oldrank)
  * `TOKEN` - Discord bot token, get from bot page in Discord Developer Portal.

## Other

You can grab messages sent with !st via Minetest. See https://github.com/MT-CTF/servermods/blob/master/server_chat/init.lua#L77 for an example
