import Formula from "game/formulas/formulas";
import { State } from "game/persistence";
import { DecimalSource } from "util/bignum";

export interface MineState {
    progress: DecimalSource;
    powered: boolean;
}

export interface ResourceState {
    type: Resources;
    amount: DecimalSource;
}

export interface DowsingState {
    resources: Resources[];
    maxConnections: number;
    powered: boolean;
}

export interface QuarryState extends DowsingState {
    progress: DecimalSource;
}

export interface EmpowererState {
    tools: Passives[];
    maxConnections: number;
    powered: boolean;
}

export interface PortalGeneratorState {
    tier: Resources | undefined;
    influences: Influences[];
}

export interface PortalState {
    id: string;
    powered: boolean;
}

export interface InfluenceState {
    type: Influences;
    data: State;
}

export interface BoosterState {
    portals: string[];
    maxConnections: number;
    powered: boolean;
    level: DecimalSource;
}

export interface UpgraderState {
    portals: string[];
    maxConnections: number;
    powered: boolean;
}

export interface AutomatorState {
    portals: string[];
    maxConnections: number;
    powered: boolean;
}

export interface InvestmentsState {
    portals: string[];
    maxConnections: number;
    powered: boolean;
}

export const mineLootTable = {
    dirt: 120,
    sand: 60,
    gravel: 40,
    wood: 30,
    stone: 24,
    coal: 20,
    copper: 15,
    iron: 12,
    silver: 10,
    gold: 8,
    emerald: 6,
    platinum: 5,
    diamond: 4,
    berylium: 3,
    unobtainium: 2,
    ultimatum: 1
} as const;

export type Resources = keyof typeof mineLootTable;
export const resourceNames = Object.keys(mineLootTable) as Resources[];

export const tools = {
    dirt: {
        cost: 1000,
        name: "Pickaxe",
        type: "passive",
        state: "dirt"
    },
    sand: {
        cost: 1e4,
        name: "Dowsing Rod",
        type: "dowsing",
        state: { resources: [], maxConnections: 1, powered: false }
    },
    gravel: {
        cost: 1e5,
        name: "Ore Processor",
        type: "passive",
        state: "gravel"
    },
    wood: {
        cost: 1e6,
        name: "Quarry",
        type: "quarry",
        state: { resources: [], maxConnections: 1, powered: false, progress: 0 }
    },
    stone: {
        cost: 1e7,
        name: "Energizer",
        type: "passive",
        state: "stone"
    },
    coal: {
        cost: 1e8,
        name: "Tool Empowerer",
        type: "empowerer",
        state: { tools: [], maxConnections: 1, powered: false }
    },
    copper: {
        cost: 1e9,
        name: "Book",
        type: "passive",
        state: "copper"
    },
    iron: {
        cost: 1e10,
        name: "Portal Generator",
        type: "portalGenerator",
        state: { tier: undefined, influences: [] }
    },
    silver: {
        cost: 1e12,
        name: "Robotics",
        type: "passive",
        state: "silver"
    },
    gold: {
        cost: 1e15,
        name: "Booster",
        type: "booster",
        state: { portals: [], maxConnections: 1, powered: false, level: 1 }
    },
    emerald: {
        cost: 1e19,
        name: "Artificial Intelligence",
        type: "passive",
        state: "emerald"
    },
    platinum: {
        cost: 1e24,
        name: "Upgrader",
        type: "upgrader",
        state: { portals: [], maxConnections: 1, powered: false }
    },
    diamond: {
        cost: 1e30,
        name: "Machine Learning",
        type: "passive",
        state: "diamond"
    },
    berylium: {
        cost: 1e37,
        name: "Automator",
        type: "automator",
        state: { portals: [], maxConnections: 1, powered: false }
    },
    unobtainium: {
        cost: 1e45,
        name: "National Grid",
        type: "passive",
        state: "unobtainium"
    },
    ultimatum: {
        cost: 1e54,
        name: "Investments",
        type: "investments",
        state: { portals: [], maxConnections: 1, powered: false }
    }
} as const satisfies Record<
    Resources,
    {
        cost: DecimalSource;
        name: string;
        type: string;
        state?: State;
    }
>;

export const relics = {
    dirt: "Replicator",
    sand: "Metal Detector",
    gravel: "Neural Networks",
    wood: "Mining Laser",
    stone: "BOGO Coupon",
    coal: "Planar Intelligence",
    copper: "Efficient Code",
    iron: "Trade Agreements",
    silver: "Machine Synergizer",
    gold: "XP Market",
    emerald: "Efficient Portals",
    platinum: "Time Dilation",
    diamond: "Paypal",
    berylium: "Tiered Mining",
    unobtainium: "Overclocked Portals",
    ultimatum: "Rebates"
} as const satisfies Record<Resources, string>;

export const passives = {
    dirt: {
        description: (empowered: boolean) =>
            empowered ? "Quadruples mining speed" : "Doubles mining speed"
    },
    gravel: {
        description: (empowered: boolean) =>
            empowered ? "Quadruples mine ore drops" : "Doubles mine ore drops"
    },
    stone: {
        description: (empowered: boolean) =>
            empowered ? "Quadruples energy gain" : "Doubles energy gain"
    },
    copper: {
        description: (empowered: boolean) =>
            empowered ? "Material level is 20% stronger" : "Material level is 10% stronger"
    },
    silver: {
        description: (empowered: boolean) =>
            empowered
                ? "Quadruples each plane's resource gain"
                : "Doubles each plane's resource gain"
    },
    diamond: {
        description: (empowered: boolean) =>
            empowered
                ? "+20% plane's resource gain per upgrade bought"
                : "+10% plane's resource gain per upgrade bought"
    },
    emerald: {
        description: (empowered: boolean) =>
            empowered
                ? "+2% plane's resource gain per minute active"
                : "+1% plane's resource gain per minute active"
    },
    unobtainium: {
        description: (empowered: boolean) =>
            empowered ? "+2 max connections per machine" : "+1 max connections per machine"
    },
    dirtRelic: {
        description: (empowered: boolean) =>
            empowered ? "Upgrades apply thrice" : "Upgrades apply twice"
    },
    sandRelic: {
        description: (empowered: boolean) =>
            empowered ? "Treasure's 2 tiers stronger" : "Treasure's 1 tier stronger"
    },
    gravelRelic: {
        description: (empowered: boolean) =>
            empowered
                ? "+2% plane's resource gain per repeatable purchase"
                : "+1% plane's resource gain per repeatable purchase"
    },
    woodRelic: {
        description: (empowered: boolean) =>
            empowered ? "(Relics)^2 boost mine speed" : "Relics boost mine speed"
    },
    stoneRelic: {
        description: (empowered: boolean) =>
            empowered ? "2 free levels for repeatables" : "1 free level for repeatables"
    },
    coalRelic: {
        description: (empowered: boolean) =>
            empowered ? "(Treasures)^2 boost planar speed" : "Treasures boost planar speed"
    },
    copperRelic: {
        description: (empowered: boolean) =>
            empowered ? "Power 2 machines free" : "Power 1 machine free"
    },
    ironRelic: {
        description: (empowered: boolean) =>
            empowered ? "Conversions give triple output" : "Conversions give double output"
    },
    silverRelic: {
        description: (empowered: boolean) =>
            empowered ? "(Power machines)^2 boost ore dropped" : "Power machines boost ore dropped"
    },
    goldRelic: {
        description: (empowered: boolean) =>
            empowered ? "Each treasure quadruples XP gain" : "Each treasure doubles XP gain"
    },
    emeraldRelic: {
        description: (empowered: boolean) =>
            empowered
                ? "Creating portals costs a third the energy"
                : "Creating portals costs half the energy"
    },
    platinumRelic: {
        description: (empowered: boolean) =>
            empowered ? "Triple dimensions' tick rate" : "Double dimensions' tick rate"
    },
    diamondRelic: {
        description: (empowered: boolean) =>
            empowered ? "Repeatables/dimensions buy max at once" : "Repeatables buy max at once"
    },
    beryliumRelic: {
        description: (empowered: boolean) =>
            empowered ? "ln(energy) boosts planar speed" : "log(energy) boosts planar speed"
    },
    unobtainiumRelic: {
        description: (empowered: boolean) =>
            empowered
                ? "Upgrades/repeatables/dimensions/prestige no longer spend on purchase"
                : "Upgrades/repeatables no longer spend on purchase"
    }
} as const satisfies Record<string, { description: (empowered: boolean) => string }>;

export type Passives = keyof typeof passives;

export const influences = {
    increaseResources: {
        display: "+resource",
        description: (state: InfluenceState) => {
            const resources = state.data as Resources[];
            if (resources.length === 0) {
                return "Increase resource odds - Drag a resource to me!";
            }
            if (resources.length === 1) {
                return `Increase ${resources[0]}'s odds`;
            }
            return `Increase ${resources.length} resources' odds`;
        },
        cost: 2,
        initialData: []
    },
    decreaseResources: {
        display: "-resource",
        description: (state: InfluenceState) => {
            const resources = state.data as Resources[];
            if (resources.length === 0) {
                return "Decrease resource odds - Drag a resource to me!";
            }
            if (resources.length === 1) {
                return `Decrease ${resources[0]}'s odds`;
            }
            return `Decrease ${resources.length} resources' odds`;
        },
        cost: 2,
        initialData: []
    },
    increaseLength: {
        display: "+length",
        description: "Increase length",
        cost: 100,
        initialData: undefined
    },
    increaseCaches: {
        display: "+caches",
        description: "Increase caches odds",
        cost: 10,
        initialData: undefined
    },
    increaseGens: {
        display: "+gens",
        description: "Increase generators odds",
        cost: 10,
        initialData: undefined
    },
    increaseInfluences: {
        display: "+influences",
        description: "Increase influences odds",
        cost: 10,
        initialData: undefined
    },
    increaseEnergyMults: {
        display: "+energy mults",
        description: "Increase energy mults odds",
        cost: 10,
        initialData: undefined
    },
    increaseResourceMults: {
        display: "+resource mults",
        description: "Increase resource mults odds",
        cost: 10,
        initialData: undefined
    },
    increaseDiff: {
        display: "+diff",
        description: "Increase difficulty/rewards odds",
        cost: 10,
        initialData: undefined
    },
    decreaseDiff: {
        display: "-diff",
        description: "Decrease difficulty/rewards odds",
        cost: 10,
        initialData: undefined
    },
    increaseRewards: {
        display: "+rewards",
        description: "Increase rewards level",
        cost: 1e4,
        initialData: undefined
    },
    relic: {
        display: "+relic",
        description: "Max length/difficulty, add tier-unique relic",
        cost: 1e6,
        initialData: undefined
    }
} as const satisfies Record<
    string,
    {
        display: string;
        description: string | ((state: InfluenceState) => string);
        cost: DecimalSource;
        initialData?: State;
    }
>;
export type Influences = keyof typeof influences;

export const increaseBoostFormula = Formula.variable(0).add(8).times(2).pow10();
