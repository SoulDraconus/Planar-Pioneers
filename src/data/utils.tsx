import { camelToTitle } from "util/common";

// Simple Fast Counter is a part of PractRand suite by Chris Doty-Humphrey.
export function sfc32(a: number, b: number, c: number, d: number) {
    return function () {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

// Modified version of this lib to use seed: https://github.com/hbi99/namegen
const morphemes = {
    1: [
        "b",
        "c",
        "d",
        "f",
        "g",
        "h",
        "i",
        "j",
        "k",
        "l",
        "m",
        "n",
        "p",
        "q",
        "r",
        "s",
        "t",
        "v",
        "w",
        "x",
        "y",
        "z"
    ],
    2: ["a", "e", "o", "u"],
    3: [
        "br",
        "cr",
        "dr",
        "fr",
        "gr",
        "pr",
        "str",
        "tr",
        "bl",
        "cl",
        "fl",
        "gl",
        "pl",
        "sl",
        "sc",
        "sk",
        "sm",
        "sn",
        "sp",
        "st",
        "sw",
        "ch",
        "sh",
        "th",
        "wh"
    ],
    4: [
        "ae",
        "ai",
        "ao",
        "au",
        "a",
        "ay",
        "ea",
        "ei",
        "eo",
        "eu",
        "e",
        "ey",
        "ua",
        "ue",
        "ui",
        "uo",
        "u",
        "uy",
        "ia",
        "ie",
        "iu",
        "io",
        "iy",
        "oa",
        "oe",
        "ou",
        "oi",
        "o",
        "oy"
    ],
    5: [
        "turn",
        "ter",
        "nus",
        "rus",
        "tania",
        "hiri",
        "hines",
        "gawa",
        "nides",
        "carro",
        "rilia",
        "stea",
        "lia",
        "lea",
        "ria",
        "nov",
        "phus",
        "mia",
        "nerth",
        "wei",
        "ruta",
        "tov",
        "zuno",
        "vis",
        "lara",
        "nia",
        "liv",
        "tera",
        "gantu",
        "yama",
        "tune",
        "ter",
        "nus",
        "cury",
        "bos",
        "pra",
        "thea",
        "nope",
        "tis",
        "clite"
    ],
    6: [
        "una",
        "ion",
        "iea",
        "iri",
        "illes",
        "ides",
        "agua",
        "olla",
        "inda",
        "eshan",
        "oria",
        "ilia",
        "erth",
        "arth",
        "orth",
        "oth",
        "illon",
        "ichi",
        "ov",
        "arvis",
        "ara",
        "ars",
        "yke",
        "yria",
        "onoe",
        "ippe",
        "osie",
        "one",
        "ore",
        "ade",
        "adus",
        "urn",
        "ypso",
        "ora",
        "iuq",
        "orix",
        "apus",
        "ion",
        "eon",
        "eron",
        "ao",
        "omia"
    ]
};
const templates = [
    [1, 2, 5],
    [2, 3, 6],
    [3, 4, 5],
    [4, 3, 6],
    [3, 4, 2, 5],
    [2, 1, 3, 6],
    [3, 4, 2, 5],
    [4, 3, 1, 6],
    [3, 4, 1, 4, 5],
    [4, 1, 4, 3, 6]
] as const;
export function getName(random: () => number) {
    const template = templates[Math.floor(random() * templates.length)];
    let name = "";
    for (let i = 0; i < template.length; i++) {
        const morphemeSet = morphemes[template[i]];
        name += morphemeSet[Math.floor(random() * morphemeSet.length)];
    }
    return camelToTitle(name);
}

const powerMorphemes = {
    1: ["a", "e", "i", "o", "u"],
    2: [
        "ph",
        "th",
        "ch",
        "sh",
        "br",
        "cr",
        "dr",
        "fr",
        "gr",
        "pr",
        "tr",
        "str",
        "sc",
        "sk",
        "sm",
        "sn",
        "sp",
        "st",
        "sw"
    ],
    3: [
        "ae",
        "ai",
        "ao",
        "au",
        "ay",
        "ea",
        "ei",
        "eo",
        "eu",
        "ey",
        "ua",
        "ue",
        "ui",
        "uo",
        "uy",
        "ia",
        "ie",
        "iu",
        "io",
        "iy",
        "oa",
        "oe",
        "ou",
        "oi",
        "oy"
    ],
    4: [
        "morp",
        "flux",
        "syn",
        "void",
        "rift",
        "dyn",
        "nov",
        "chron",
        "lum",
        "par",
        "ter",
        "psy",
        "phan",
        "man",
        "grav",
        "pyr",
        "cry",
        "hydr",
        "elec",
        "kin",
        "nan",
        "omni"
    ],
    5: [
        "ance",
        "ation",
        "esis",
        "ergy",
        "tide",
        "al",
        "ism",
        "ity",
        "mancy",
        "urgy",
        "pathy",
        "port",
        "shift",
        "burst",
        "pulse",
        "wave",
        "field",
        "storm",
        "force",
        "blade"
    ]
};
const powerTemplates = [
    [1, 2, 1, 4, 5],
    [1, 4, 5],
    [2, 1, 4, 5],
    [1, 2, 3, 4, 5],
    [3, 4, 5]
] as const;

export function getPowerName(random: () => number) {
    const template = powerTemplates[Math.floor(random() * powerTemplates.length)];
    let name = "";
    for (let i = 0; i < template.length; i++) {
        const morphemeSet = powerMorphemes[template[i]];
        name += morphemeSet[Math.floor(random() * morphemeSet.length)];
    }
    return camelToTitle(name);
}

export function getColor(base: [number, number, number], random: () => number) {
    const [h, s, v] = rgb2hsv(...base);
    let newH = Math.floor(random() * 320);
    if (newH > h - 20) {
        newH += 40;
    }
    const [r, g, b] = hsv2rgb(newH, s, v);
    return `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
}

// https://stackoverflow.com/a/54070620/4376101
// input: r,g,b in [0,1], out: h in [0,360) and s,v in [0,1]
function rgb2hsv(r: number, g: number, b: number) {
    const v = Math.max(r, g, b),
        c = v - Math.min(r, g, b);
    const h = c && (v == r ? (g - b) / c : v == g ? 2 + (b - r) / c : 4 + (r - g) / c);
    return [60 * (h < 0 ? h + 6 : h), v && c / v, v];
}

// https://stackoverflow.com/a/54024653/4376101
// input: h in [0,360] and s,v in [0,1] - output: r,g,b in [0,1]
function hsv2rgb(h: number, s: number, v: number) {
    const f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return [f(5), f(3), f(1)];
}
