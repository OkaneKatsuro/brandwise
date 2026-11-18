// What a generation may be asked with, whichever provider makes it.

/** What a model id looks like. It becomes an argument of a provider's command, so nothing else is passed on. */
export const MODEL_ID = /^[a-z0-9_.-]{2,64}$/;

/** The longest prompt a generation takes, in characters. A style's template alone must fit, or it could never be used. */
export const MAX_PROMPT = 2000;
