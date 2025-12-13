declare global {
	namespace NodeJS {
		interface ProcessEnv {
			/**
			 * Guild ID, used to update the slash commands specifically instead of globally (faster)
			 */
			GUILD_ID: string;
			/**
			 * Channel ID, used to determine which channel should the bot display the global leaderboard
			 */
			RANKINGS_CHANNEL: string;
			/**
			 * The Bot token, used to authenticate to the Discord API
			 */
			TOKEN: string;
			/**
			 * Channel ID, used to update game stats message
			 */
			GAME_STATS_CHANNEL: string;

			// Controls wether REDIS should be used. Default: yes
			USE_REDIS: string
		}
	}
}

export { }