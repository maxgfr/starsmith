/** The tool's name and home, in one place so a rename touches only this file and action.yml. */
export const TOOL_NAME = "starsmith";
export const TOOL_REPO = "maxgfr/starsmith";
export const TOOL_URL = `https://github.com/${TOOL_REPO}`;

/** Where the persistent state lives, relative to the workspace. */
export const STATE_PATH = `.${TOOL_NAME}/state.json`;
export const STATE_VERSION = 1;

/** Default config file, relative to the workspace. Missing is fine. */
export const CONFIG_PATH = `.github/${TOOL_NAME}.yml`;

export const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference";
export const GITHUB_MODELS_DEFAULT_MODEL = "openai/gpt-4.1-mini";
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";

/** Group used for repositories without a language, topic, list or category. */
export const OTHERS = "Others";
export const PINNED = "📌 Pinned";
