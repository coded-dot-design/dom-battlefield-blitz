// Shared site facts (read at build time).
import pkg from "../../package.json";
export const VERSION = pkg.version;
export const REPO = "https://github.com/coded-dot-design/dom-battlefield-blitz";
export const HUB = "https://domvirus.com/";
// The original game has its own site (repo dom-battlefield).
export const BATTLEFIELD = "https://battlefield.domvirus.com/";
export const BATTLEFIELD_PLAY = `${BATTLEFIELD}play/`;
export const base = (path = "") => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/${path}`;
// The fizlet-rooms server for two-player games at /play/two/ (owner-deployed; ?rooms= overrides it).
export const ROOMS = import.meta.env.PUBLIC_ROOMS_URL || "wss://fizlet-rooms.fizlet.workers.dev";
