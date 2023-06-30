# CTF Discord Bot

Requires Node v16.9.0

License: MIT

## Features

- Show rank stats embed for a player.
  - `/rank` - Stats for player with the Discord user's username or nickname.
  - `/rank username` - Stats for player `username`.
  - `/x` - Send message on the staff channel (See [this](https://github.com/MT-CTF/servermods/blob/master/server_chat/init.lua#L77)).
  - `/mute user` - Mute Discord member.
  - `/unmute user` - Unmute Discord member.
  - `/leaders` - Redirect to the leaderboard channel.
- Posts leaderboard to a channel, editing existing messages.

## Usage

- Create Discord bot and application using the [Discord Developer Portal](https://discord.com/developers/applications/),
  as shown in [this guide](https://discordjs.guide/preparations/setting-up-a-bot-application.html#creating-your-bot).
- Invite the Discord bot to the desired server, as shown in
  [this guide](https://discordjs.guide/preparations/adding-your-bot-to-servers.html#bot-invite-links).
- Install dependencies: `npm install`.
- Run with environment variables: `GUILD_ID=guild_id RANKINGS_CHANNEL=id TOKEN=discord_token npm start`
  - `GUILD_ID` - Guild ID used for slash commands.
  - `RANKINGS_CHANNEL` - Channel ID for the leaderboard.
  - `TOKEN` - Discord bot token, get from bot page in Discord Developer Portal.
- The environment variables can also be placed in a `.env` file that will be automatically loaded at startup.