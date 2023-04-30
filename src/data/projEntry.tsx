import Modal from "components/Modal.vue";
import StickyVue from "components/layout/Sticky.vue";
import {
    BoardNode,
    BoardNodeLink,
    GenericBoard,
    NodeLabel,
    ProgressDisplay,
    Shape,
    createBoard,
    getUniqueNodeID
} from "features/boards/board";
import { jsx } from "features/feature";
import { createResource } from "features/resources/resource";
import { createTabFamily } from "features/tabs/tabFamily";
import Formula, { calculateCost } from "game/formulas/formulas";
import { GenericFormula, InvertibleIntegralFormula } from "game/formulas/types";
import { BaseLayer, GenericLayer, addLayer, createLayer, layers } from "game/layers";
import {
    Modifier,
    createAdditiveModifier,
    createMultiplicativeModifier,
    createSequentialModifier
} from "game/modifiers";
import { State } from "game/persistence";
import type { LayerData, Player } from "game/player";
import player from "game/player";
import settings from "game/settings";
import Decimal, { DecimalSource } from "lib/break_eternity";
import { format, formatWhole } from "util/bignum";
import { WithRequired, camelToTitle } from "util/common";
import { render } from "util/vue";
import { ComputedRef, computed, nextTick, reactive, ref, watch } from "vue";
import { useToast } from "vue-toastification";
import { Section, createCollapsibleModifierSections, createFormulaPreview } from "./common";
import "./main.css";
import { GenericPlane, createPlane } from "./planes";

const toast = useToast();

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
    influences: string[];
}

export interface PortalState {
    id: string;
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

const tools = {
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
        state: { tier: null, influences: [] }
    },
    silver: {
        cost: 1e12,
        name: "Unknown Item",
        type: "unknownType"
    },
    gold: {
        cost: 1e15,
        name: "Unknown Item",
        type: "unknownType"
    },
    emerald: {
        cost: 1e19,
        name: "Unknown Item",
        type: "unknownType"
    },
    platinum: {
        cost: 1e24,
        name: "Unknown Item",
        type: "unknownType"
    },
    diamond: {
        cost: 1e30,
        name: "Unknown Item",
        type: "unknownType"
    },
    berylium: {
        cost: 1e37,
        name: "Unknown Item",
        type: "unknownType"
    },
    unobtainium: {
        cost: 1e45,
        name: "Unknown Item",
        type: "unknownType"
    },
    ultimatum: {
        cost: 1e54,
        name: "Unknown Item",
        type: "unknownType"
    }
} as Record<
    Resources,
    {
        cost: DecimalSource;
        name: string;
        type: string;
        state?: State;
    }
>;

const passives = {
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
    }
} as const;

export type Passives = keyof typeof passives;

/**
 * @hidden
 */
export const main = createLayer("main", function (this: BaseLayer) {
    const energy = createResource<DecimalSource>(0, "energy");

    const resourceLevelFormula = Formula.variable(0).add(1);

    const resourceNodes: ComputedRef<Record<Resources, BoardNode>> = computed(() =>
        board.types.resource.nodes.value.reduce((acc, curr) => {
            acc[(curr.state as unknown as ResourceState).type] = curr;
            return acc;
        }, {} as Record<Resources, BoardNode>)
    );

    const toolNodes: ComputedRef<Record<Resources, BoardNode>> = computed(() => ({
        ...board.types.passive.nodes.value.reduce((acc, curr) => {
            acc[curr.state as Resources] = curr;
            return acc;
        }, {} as Record<Resources, BoardNode>),
        sand: board.types.dowsing.nodes.value[0],
        wood: board.types.quarry.nodes.value[0],
        coal: board.types.empowerer.nodes.value[0],
        iron: board.types.portalGenerator.nodes.value[0]
    }));

    const resourceLevels = computed(() =>
        resourceNames.reduce((acc, curr) => {
            const amount =
                (resourceNodes.value[curr]?.state as unknown as ResourceState | undefined)
                    ?.amount ?? 0;
            // Sub 10 and then manually sum until we go over amount
            let currentLevel = Decimal.floor(resourceLevelFormula.invertIntegral(amount))
                .sub(10)
                .clampMin(0);
            let summedCost = calculateCost(resourceLevelFormula, currentLevel, true, 0);
            while (true) {
                const nextCost = resourceLevelFormula.evaluate(currentLevel);
                if (Decimal.add(summedCost, nextCost).lte(amount)) {
                    currentLevel = currentLevel.add(1);
                    summedCost = Decimal.add(summedCost, nextCost);
                } else {
                    break;
                }
            }
            acc[curr] = currentLevel;
            return acc;
        }, {} as Record<Resources, DecimalSource>)
    );
    function getResourceLevelProgress(resource: Resources) {
        const amount =
            (resourceNodes.value[resource]?.state as unknown as ResourceState | undefined)
                ?.amount ?? 0;
        const currentLevel = resourceLevels.value[resource];
        const requiredForCurrentLevel = calculateCost(resourceLevelFormula, currentLevel, true);
        const requiredForNextLevel = calculateCost(
            resourceLevelFormula,
            Decimal.add(currentLevel, 1),
            true
        );
        return Decimal.sub(amount, requiredForCurrentLevel)
            .max(0)
            .div(Decimal.sub(requiredForNextLevel, requiredForCurrentLevel))
            .toNumber();
    }

    const resourceMinedCooldown: Partial<Record<Resources, number>> = reactive({});
    const resourceQuarriedCooldown: Partial<Record<Resources, number>> = reactive({});

    nextTick(() => {
        resourceNames.forEach(resource => {
            watch(
                () => resourceLevels.value[resource],
                (level, prevLevel) => {
                    if (Decimal.gt(level, prevLevel) && settings.active === player.id) {
                        toast.info(
                            <div>
                                <h3>
                                    {Decimal.eq(level, 1)
                                        ? `${camelToTitle(resource)} discovered`
                                        : `${camelToTitle(resource)} is now Level ${formatWhole(
                                              level
                                          )}`}
                                    !
                                </h3>
                                <div>Energy gain is now 1.01x higher.</div>
                            </div>
                        );
                    }
                }
            );
        });
    });

    const poweredMachines: ComputedRef<number> = computed(() => {
        return [mine, dowsing, quarry, empowerer].filter(
            node => (node.value?.state as { powered: boolean })?.powered
        ).length;
    });
    const nextPowerCost = computed(() =>
        Decimal.eq(poweredMachines.value, 0)
            ? 10
            : Decimal.add(poweredMachines.value, 1).pow_base(100).div(10).times(0.99)
    );

    const quarryProgressRequired = computed(() => {
        if (quarry.value == null) {
            return 0;
        }
        const resources = (quarry.value.state as unknown as QuarryState).resources;
        return resources.reduce(
            (acc, curr) => Decimal.div(100, dropRates[curr].computedModifier.value).add(acc),
            Decimal.dZero
        );
    });

    const deselectAllAction = {
        id: "deselect",
        icon: "close",
        tooltip: (node: BoardNode) => ({
            text:
                "resources" in (node.state as object) ? "Disconnect resources" : "Disconnect tools"
        }),
        onClick(node: BoardNode) {
            if ("resources" in (node.state as object)) {
                node.state = { ...(node.state as object), resources: [] };
            } else if ("tools" in (node.state as object)) {
                node.state = { ...(node.state as object), tools: [] };
            }
            board.selectedAction.value = null;
            board.selectedNode.value = null;
        },
        visibility: (node: BoardNode) => {
            if ("resources" in (node.state as object)) {
                return (node.state as { resources: Resources[] }).resources.length > 0;
            }
            if ("tools" in (node.state as object)) {
                return (node.state as { tools: Passives[] }).tools.length > 0;
            }
            return true;
        }
    };

    const togglePoweredAction = {
        id: "toggle",
        icon: "bolt",
        tooltip: (node: BoardNode) => ({
            text: (node.state as { powered: boolean }).powered
                ? "Turn Off"
                : `Turn On - Always runs for ${formatWhole(nextPowerCost.value)} energy/s`
        }),
        onClick(node: BoardNode) {
            node.state = {
                ...(node.state as object),
                powered: !(node.state as { powered: boolean }).powered
            };
            board.selectedAction.value = null;
        },
        fillColor: (node: BoardNode) =>
            (node.state as { powered: boolean }).powered ? "var(--accent1)" : "var(--locked)"
    };

    function getIncreaseConnectionsAction(
        cost: (x: InvertibleIntegralFormula) => GenericFormula,
        maxConnections = Infinity
    ) {
        const formula = cost(Formula.variable(0));
        return {
            id: "moreConnections",
            icon: "hub",
            formula,
            tooltip(node: BoardNode) {
                return {
                    text: `Increase Connections - ${formatWhole(
                        formula.evaluate((node.state as { maxConnections: number }).maxConnections)
                    )} energy`
                };
            },
            confirmationLabel: (node: BoardNode) =>
                Decimal.gte(
                    energy.value,
                    formula.evaluate((node.state as { maxConnections: number }).maxConnections)
                )
                    ? { text: "Tap again to confirm" }
                    : { text: "Cannot afford", color: "var(--danger)" },
            onClick(node: BoardNode) {
                const cost = formula.evaluate(
                    (node.state as { maxConnections: number }).maxConnections
                );
                if (Decimal.gte(energy.value, cost)) {
                    energy.value = Decimal.sub(energy.value, cost);
                }
                node.state = {
                    ...(node.state as object),
                    maxConnections: (node.state as { maxConnections: number }).maxConnections + 1
                };
                board.selectedAction.value = null;
            },
            visibility: (node: BoardNode) =>
                (node.state as { maxConnections: number }).maxConnections < maxConnections
        };
    }

    function labelForAcceptingResource(
        node: BoardNode,
        description: (resource: Resources) => string
    ): NodeLabel | null {
        if ((board as GenericBoard).draggingNode.value?.type === "resource") {
            const resource = (
                (board as GenericBoard).draggingNode.value?.state as unknown as ResourceState
            ).type;
            const { maxConnections, resources } = node.state as unknown as DowsingState;
            if (resources.includes(resource)) {
                return { text: "Disconnect", color: "var(--accent2)" };
            }
            if (resources.length === maxConnections) {
                return { text: "Max connections", color: "var(--danger)" };
            }
            return {
                text: description(resource),
                color: "var(--accent2)"
            };
        }
        return null;
    }

    function labelForAcceptingTool(
        node: BoardNode,
        description: (passive: Passives) => string
    ): NodeLabel | null {
        if ((board as GenericBoard).draggingNode.value?.type === "passive") {
            const passive = (board as GenericBoard).draggingNode.value?.state as Passives;
            const { maxConnections, tools } = node.state as unknown as EmpowererState;
            if (tools.includes(passive)) {
                return { text: "Disconnect", color: "var(--accent2)" };
            }
            if (tools.length === maxConnections) {
                return { text: "Max connections", color: "var(--danger)" };
            }
            return {
                text: description(passive),
                color: "var(--accent2)"
            };
        }
        return null;
    }

    function canAcceptResource(node: BoardNode, otherNode: BoardNode) {
        if (otherNode.type !== "resource") {
            return false;
        }
        const resource = (otherNode.state as unknown as ResourceState).type;
        const { maxConnections, resources } = node.state as unknown as DowsingState;
        if (resources.includes(resource)) {
            return true;
        }
        if (resources.length === maxConnections) {
            return false;
        }
        return true;
    }

    function onDropResource(node: BoardNode, otherNode: BoardNode) {
        if (otherNode.type !== "resource") {
            return;
        }
        const resource = (otherNode.state as unknown as ResourceState).type;
        const resources = (node.state as unknown as { resources: Resources[] }).resources;
        if (resources.includes(resource)) {
            node.state = {
                ...(node.state as object),
                resources: resources.filter(r => r !== resource)
            };
        } else {
            node.state = {
                ...(node.state as object),
                resources: [...resources, resource]
            };
        }
        board.selectedNode.value = node;
    }

    function canAcceptTool(node: BoardNode, otherNode: BoardNode) {
        if (otherNode.type !== "passive") {
            return false;
        }
        const passive = otherNode.state as Passives;
        const { maxConnections, tools } = node.state as unknown as EmpowererState;
        if (tools.includes(passive)) {
            return true;
        }
        if (tools.length === maxConnections) {
            return false;
        }
        return true;
    }

    function onDropTool(node: BoardNode, otherNode: BoardNode) {
        if (otherNode.type !== "passive") {
            return;
        }
        const passive = otherNode.state as Passives;
        const tools = (node.state as unknown as { tools: Passives[] }).tools;
        if (tools.includes(passive)) {
            node.state = {
                ...(node.state as object),
                tools: tools.filter(r => r !== passive)
            };
        } else {
            node.state = {
                ...(node.state as object),
                tools: [...tools, passive]
            };
        }
        board.selectedNode.value = node;
    }

    const board = createBoard(board => ({
        startNodes: () => [
            { position: { x: 0, y: 0 }, type: "mine", state: { progress: 0, powered: false } },
            { position: { x: 0, y: -200 }, type: "brokenFactory" }
        ],
        types: {
            mine: {
                shape: Shape.Diamond,
                size: 50,
                title: "🪨",
                label: node =>
                    node === board.selectedNode.value
                        ? { text: "Mining" }
                        : Object.keys(resourceNodes.value).length === 0
                        ? { text: "Click me!" }
                        : null,
                actionDistance: Math.PI / 4,
                actions: [togglePoweredAction],
                progress: node =>
                    isPowered(node)
                        ? new Decimal((node.state as unknown as MineState).progress).toNumber()
                        : 0,
                progressDisplay: ProgressDisplay.Outline,
                progressColor: "var(--accent2)",
                classes: node => ({
                    running: isPowered(node)
                }),
                draggable: true
            },
            brokenFactory: {
                shape: Shape.Diamond,
                size: 50,
                title: "🛠️",
                label: node =>
                    node === board.selectedNode.value ? { text: "Broken Forge" } : null,
                actionDistance: Math.PI / 4,
                actions: [
                    {
                        id: "repair",
                        icon: "build",
                        tooltip: { text: "Repair - 100 energy" },
                        onClick(node) {
                            if (Decimal.gte(energy.value, 100)) {
                                node.type = "factory";
                                energy.value = Decimal.sub(energy.value, 100);
                            }
                        },
                        confirmationLabel: () =>
                            Decimal.gte(energy.value, 1000)
                                ? { text: "Tap again to confirm" }
                                : { text: "Cannot afford", color: "var(--danger)" }
                    }
                ],
                draggable: true
            },
            factory: {
                shape: Shape.Diamond,
                size: 50,
                title: "🛠️",
                label: node => {
                    if (node === board.selectedNode.value) {
                        return {
                            text:
                                node.state == null
                                    ? "Forge - Drag a resource to me!"
                                    : `Forging ${tools[node.state as Resources].name}`
                        };
                    }
                    if ((board as GenericBoard).draggingNode.value?.type === "resource") {
                        const resource = (
                            (board as GenericBoard).draggingNode.value
                                ?.state as unknown as ResourceState
                        ).type;
                        const text = node.state === resource ? "Disconnect" : tools[resource].name;
                        const color =
                            node.state === resource ||
                            (Decimal.gte(energy.value, tools[resource].cost) &&
                                toolNodes.value[resource] == null)
                                ? "var(--accent2)"
                                : "var(--danger)";
                        return {
                            text,
                            color
                        };
                    }
                    return null;
                },
                actionDistance: Math.PI / 4,
                actions: [
                    {
                        id: "deselect",
                        icon: "close",
                        tooltip: { text: "Disconnect resource" },
                        onClick(node) {
                            node.state = undefined;
                            board.selectedAction.value = null;
                            board.selectedNode.value = null;
                        },
                        visibility: node => node.state != null
                    },
                    {
                        id: "craft",
                        icon: "done",
                        tooltip: node => ({
                            text: `Forge ${tools[node.state as Resources].name} - ${formatWhole(
                                tools[node.state as Resources].cost
                            )} energy`
                        }),
                        onClick(node) {
                            const tool = tools[node.state as Resources];
                            if (
                                Decimal.gte(energy.value, tool.cost) &&
                                toolNodes.value[node.state as Resources] == null
                            ) {
                                energy.value = Decimal.sub(energy.value, tool.cost);
                                const newNode = {
                                    id: getUniqueNodeID(board as GenericBoard),
                                    position: { ...node.position },
                                    type: tool.type,
                                    state: tool.state
                                };
                                board.placeInAvailableSpace(newNode);
                                board.nodes.value.push(newNode);
                                board.selectedAction.value = null;
                                board.selectedNode.value = null;
                                node.state = undefined;
                            }
                        },
                        fillColor: node =>
                            Decimal.gte(energy.value, tools[node.state as Resources].cost) &&
                            toolNodes.value[node.state as Resources] == null
                                ? "var(--accent2)"
                                : "var(--danger)",
                        visibility: node => node.state != null,
                        confirmationLabel: node =>
                            Decimal.gte(energy.value, tools[node.state as Resources].cost)
                                ? toolNodes.value[node.state as Resources] == null
                                    ? { text: "Tap again to confirm" }
                                    : { text: "Already crafted", color: "var(--danger)" }
                                : { text: "Cannot afford", color: "var(--danger)" }
                    }
                ],
                progress: node =>
                    node.state == null || toolNodes.value[node.state as Resources] != null
                        ? 0
                        : Decimal.div(energy.value, tools[node.state as Resources].cost)
                              .clampMax(1)
                              .toNumber(),
                progressDisplay: ProgressDisplay.Fill,
                progressColor: node =>
                    node.state != null &&
                    Decimal.gte(energy.value, tools[node.state as Resources].cost)
                        ? "var(--accent2)"
                        : "var(--foreground)",
                canAccept(node, otherNode) {
                    return otherNode.type === "resource";
                },
                onDrop(node, otherNode) {
                    const droppedType = (otherNode.state as unknown as ResourceState).type;
                    if (node.state === droppedType) {
                        node.state = undefined;
                    } else {
                        node.state = droppedType;
                    }
                    board.selectedNode.value = node;
                },
                draggable: true
            },
            resource: {
                shape: Shape.Circle,
                size: 50,
                title: node => camelToTitle((node.state as unknown as ResourceState).type),
                subtitle: node => formatWhole((node.state as unknown as ResourceState).amount),
                progress: node =>
                    getResourceLevelProgress((node.state as unknown as ResourceState).type),
                // Make clicking resources a no-op so they can't be selected
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                onClick() {},
                progressDisplay: ProgressDisplay.Outline,
                progressColor: "var(--accent3)",
                classes: node => ({
                    "affected-node":
                        (dowsing.value != null &&
                            isPowered(dowsing.value) &&
                            (dowsing.value.state as unknown as DowsingState).resources.includes(
                                (node.state as unknown as ResourceState).type
                            )) ||
                        Decimal.neq(
                            planarMultis.value[(node.state as unknown as ResourceState).type] ?? 1,
                            1
                        )
                }),
                draggable: true
            },
            passive: {
                shape: Shape.Circle,
                size: 50,
                title: node => tools[node.state as Resources].name,
                label: node =>
                    node === board.selectedNode.value
                        ? {
                              text: passives[node.state as Passives].description(
                                  empowerer.value != null &&
                                      isPowered(empowerer.value) &&
                                      (
                                          empowerer.value.state as unknown as EmpowererState
                                      ).tools.includes(node.state as Passives)
                              )
                          }
                        : null,
                outlineColor: "var(--bought)",
                classes: node => ({
                    "affected-node":
                        empowerer.value != null &&
                        isPowered(empowerer.value) &&
                        (empowerer.value.state as unknown as EmpowererState).tools.includes(
                            node.state as Passives
                        )
                }),
                draggable: true
            },
            dowsing: {
                shape: Shape.Diamond,
                size: 50,
                title: "🥢",
                label: node => {
                    if (node === board.selectedNode.value) {
                        return {
                            text:
                                (node.state as unknown as DowsingState).resources.length === 0
                                    ? "Dowsing - Drag a resource to me!"
                                    : `Dowsing (${
                                          (node.state as { resources: Resources[] }).resources
                                              .length
                                      }/${
                                          (node.state as { maxConnections: number }).maxConnections
                                      })`
                        };
                    }
                    return labelForAcceptingResource(node, resource => `Double ${resource} odds`);
                },
                actionDistance: Math.PI / 4,
                actions: [
                    deselectAllAction,
                    getIncreaseConnectionsAction(x => x.add(2).pow_base(100), 16),
                    togglePoweredAction
                ],
                classes: node => ({
                    running: isPowered(node)
                }),
                canAccept: canAcceptResource,
                onDrop: onDropResource,
                draggable: true
            },
            quarry: {
                shape: Shape.Diamond,
                size: 50,
                title: "⛏️",
                label: node => {
                    if (node === board.selectedNode.value) {
                        return {
                            text:
                                (node.state as unknown as DowsingState).resources.length === 0
                                    ? "Quarry - Drag a resource to me!"
                                    : `Quarrying (${
                                          (node.state as { resources: Resources[] }).resources
                                              .length
                                      }/${
                                          (node.state as { maxConnections: number }).maxConnections
                                      })`
                        };
                    }
                    return labelForAcceptingResource(
                        node,
                        resource =>
                            `Gather ${format(
                                Decimal.div(dropRates[resource].computedModifier.value, 100)
                            )} ${resource}/s`
                    );
                },
                actionDistance: Math.PI / 4,
                actions: [
                    deselectAllAction,
                    getIncreaseConnectionsAction(x => x.add(2).pow_base(10000), 16),
                    togglePoweredAction
                ],
                progress: node =>
                    isPowered(node)
                        ? Decimal.eq(quarryProgressRequired.value, 0)
                            ? 0
                            : new Decimal((node.state as unknown as QuarryState).progress)
                                  .div(quarryProgressRequired.value)
                                  .toNumber()
                        : 0,
                progressDisplay: ProgressDisplay.Outline,
                progressColor: "var(--accent2)",
                canAccept: canAcceptResource,
                onDrop: onDropResource,
                classes: node => ({
                    running: isPowered(node)
                }),
                draggable: true
            },
            empowerer: {
                shape: Shape.Diamond,
                size: 50,
                title: "🔌",
                label: node => {
                    if (node === board.selectedNode.value) {
                        return {
                            text:
                                (node.state as unknown as EmpowererState).tools.length === 0
                                    ? "Empowerer - Drag a tool to me!"
                                    : `Empowering (${
                                          (node.state as { tools: Passives[] }).tools.length
                                      }/${
                                          (node.state as { maxConnections: number }).maxConnections
                                      })`
                        };
                    }
                    return labelForAcceptingTool(
                        node,
                        passive => `Double ${tools[passive].name}'s effect`
                    );
                },
                actionDistance: Math.PI / 4,
                actions: [
                    deselectAllAction,
                    getIncreaseConnectionsAction(x => x.add(3).pow_base(1000), 16),
                    togglePoweredAction
                ],
                canAccept: canAcceptTool,
                onDrop: onDropTool,
                classes: node => ({
                    running: isPowered(node)
                }),
                draggable: true
            },
            portalGenerator: {
                shape: Shape.Diamond,
                size: 50,
                title: "⛩️",
                label: node => {
                    if (node === board.selectedNode.value) {
                        return {
                            text:
                                (node.state as unknown as PortalGeneratorState).tier == null
                                    ? "Portal Spawner - Drag a resource to me!"
                                    : `Spawning ${
                                          (node.state as unknown as PortalGeneratorState).tier
                                      }-tier portal`
                        };
                    }
                    if ((board as GenericBoard).draggingNode.value?.type === "resource") {
                        const resource = (
                            (board as GenericBoard).draggingNode.value
                                ?.state as unknown as ResourceState
                        ).type;
                        const text =
                            (node.state as unknown as PortalGeneratorState).tier === resource
                                ? "Disconnect"
                                : `${camelToTitle(resource)}-tier Portal`;
                        return {
                            text,
                            color: "var(--accent2)"
                        };
                    }
                    // TODO handle influences
                    return null;
                },
                actionDistance: Math.PI / 4,
                actions: [
                    {
                        id: "deselect",
                        icon: "close",
                        tooltip: { text: "Disconnect all" },
                        onClick(node: BoardNode) {
                            node.state = {
                                ...(node.state as object),
                                tier: undefined,
                                influences: []
                            };
                            board.selectedAction.value = null;
                            board.selectedNode.value = null;
                        },
                        visibility: (node: BoardNode) => {
                            const { tier, influences } =
                                node.state as unknown as PortalGeneratorState;
                            return tier != null || influences.length > 0;
                        }
                    },
                    {
                        id: "makePortal",
                        icon: "done",
                        tooltip: node => ({
                            text: `Spawn ${
                                (node.state as unknown as PortalGeneratorState).tier
                            }-tier portal`
                        }),
                        onClick(node) {
                            let id = 0;
                            while (`portal-${id}` in layers) {
                                id++;
                            }
                            addLayer(
                                createPlane(
                                    `portal-${id}`,
                                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                    (node.state as unknown as PortalGeneratorState).tier!,
                                    Math.floor(Math.random() * 4294967296)
                                ),
                                player
                            );
                            const newNode = {
                                id: getUniqueNodeID(board as GenericBoard),
                                position: { ...node.position },
                                type: "portal",
                                state: { id: `portal-${id}`, powered: false }
                            };
                            board.placeInAvailableSpace(newNode);
                            board.nodes.value.push(newNode);
                            board.selectedAction.value = null;
                            board.selectedNode.value = null;
                            node.state = { tier: undefined, influences: [] };
                        },
                        visibility: node =>
                            (node.state as unknown as PortalGeneratorState).tier != null
                    }
                ],
                canAccept(node, otherNode) {
                    return otherNode.type === "resource" || otherNode.type === "influence";
                },
                onDrop(node, otherNode) {
                    if (otherNode.type === "resource") {
                        const droppedType = (otherNode.state as unknown as ResourceState).type;
                        const currentType = (node.state as unknown as PortalGeneratorState).tier;
                        node.state = {
                            ...(node.state as object),
                            tier: droppedType === currentType ? undefined : droppedType
                        };
                    } else if (otherNode.type === "influence") {
                        const droppedInfluence = otherNode.state as string;
                        const currentInfluences = (node.state as unknown as PortalGeneratorState)
                            .influences;
                        if (currentInfluences.includes(droppedInfluence)) {
                            node.state = {
                                ...(node.state as object),
                                influences: currentInfluences.filter(i => i !== droppedInfluence)
                            };
                        } else {
                            node.state = {
                                ...(node.state as object),
                                influences: [...currentInfluences, droppedInfluence]
                            };
                        }
                    }
                    board.selectedNode.value = node;
                },
                draggable: true
            },
            portal: {
                shape: Shape.Diamond,
                size: 50,
                title: "🌀",
                label: node =>
                    node === board.selectedNode.value
                        ? {
                              text: `Portal to ${
                                  (
                                      layers[
                                          (node.state as unknown as PortalState).id
                                      ] as GenericPlane
                                  ).name
                              }`,
                              color: (
                                  layers[(node.state as unknown as PortalState).id] as GenericPlane
                              ).color
                          }
                        : null,
                actionDistance: Math.PI / 4,
                actions: [togglePoweredAction],
                classes: node => ({
                    running: isPowered(node),
                    showNotif: (layers[(node.state as unknown as PortalState).id] as GenericPlane)
                        .showNotif.value
                }),
                outlineColor: node =>
                    (layers[(node.state as unknown as PortalState).id] as GenericPlane).background,
                draggable: true
            }
        },
        style: {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: "hidden"
        },
        links() {
            const links: BoardNodeLink[] = [];
            links.push(
                ...Object.keys(resourceMinedCooldown).map(resource => ({
                    startNode: mine.value,
                    endNode: resourceNodes.value[resource as Resources],
                    stroke: "var(--accent3)",
                    strokeWidth: 5
                }))
            );
            if (factory.value != null && factory.value.state != null) {
                links.push({
                    startNode: factory.value,
                    endNode: resourceNodes.value[factory.value.state as Resources],
                    stroke: "var(--foreground)",
                    strokeWidth: 4
                });
            }
            if (dowsing.value != null) {
                (dowsing.value.state as unknown as DowsingState).resources.forEach(resource => {
                    links.push({
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        startNode: dowsing.value!,
                        endNode: resourceNodes.value[resource],
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        stroke: isPowered(dowsing.value!) ? "var(--accent1)" : "var(--foreground)",
                        strokeWidth: 4
                    });
                });
            }
            if (quarry.value != null) {
                (quarry.value.state as unknown as QuarryState).resources.forEach(resource => {
                    links.push({
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        startNode: quarry.value!,
                        endNode: resourceNodes.value[resource],
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        stroke: "var(--foreground)",
                        strokeWidth: 4
                    });
                });
            }
            links.push(
                ...Object.keys(resourceQuarriedCooldown).map(resource => ({
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    startNode: quarry.value!,
                    endNode: resourceNodes.value[resource as Resources],
                    stroke: "var(--accent3)",
                    strokeWidth: 5
                }))
            );
            if (empowerer.value != null) {
                (empowerer.value.state as unknown as EmpowererState).tools.forEach(tool => {
                    links.push({
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        startNode: empowerer.value!,
                        endNode: toolNodes.value[tool],
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        stroke: isPowered(empowerer.value!)
                            ? "var(--accent1)"
                            : "var(--foreground)",
                        strokeWidth: 4
                    });
                });
            }
            if (portalGenerator.value != null) {
                if ((portalGenerator.value.state as unknown as PortalGeneratorState).tier != null) {
                    links.push({
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        startNode: portalGenerator.value!,
                        endNode:
                            resourceNodes.value[
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                (portalGenerator.value.state as unknown as PortalGeneratorState)
                                    .tier!
                            ],
                        stroke: "var(--foreground)",
                        strokeWidth: 4
                    });
                    // TODO link to influences
                }
                (board as GenericBoard).types.portal.nodes.value.forEach(node => {
                    const plane = layers[(node.state as unknown as PortalState).id] as GenericPlane;
                    plane.links.value.forEach(n => {
                        if (n.value != null) {
                            links.push({
                                startNode: node,
                                endNode: n.value,
                                stroke: isPowered(node) ? "var(--accent3)" : "var(--foreground)",
                                strokeWidth: 4
                            });
                        }
                    });
                    (Object.keys(plane.resourceMultis.value) as (Resources | "energy")[]).forEach(
                        type => {
                            if (type !== "energy" && type in resourceNodes.value) {
                                links.push({
                                    startNode: node,
                                    endNode: resourceNodes.value[type],
                                    stroke: isPowered(node)
                                        ? "var(--accent1)"
                                        : "var(--foreground)",
                                    strokeWidth: 4
                                });
                            }
                        }
                    );
                    return links;
                });
            }
            return links;
        }
    }));

    function isPowered(node: BoardNode): boolean {
        return node === board.selectedNode.value || (node.state as { powered: boolean }).powered;
    }

    const mine: ComputedRef<BoardNode> = computed(() => board.types.mine.nodes.value[0]);
    const factory: ComputedRef<BoardNode | undefined> = computed(
        () => board.types.factory.nodes.value[0]
    );
    const dowsing: ComputedRef<BoardNode | undefined> = computed(() => toolNodes.value.sand);
    const quarry: ComputedRef<BoardNode | undefined> = computed(() => toolNodes.value.wood);
    const empowerer: ComputedRef<BoardNode | undefined> = computed(() => toolNodes.value.coal);
    const portalGenerator: ComputedRef<BoardNode | undefined> = computed(
        () => toolNodes.value.iron
    );

    function grantResource(type: Resources, amount: DecimalSource) {
        let node = resourceNodes.value[type];
        amount = Decimal.times(amount, resourceGain[type].computedModifier.value);
        if (node == null) {
            node = {
                id: getUniqueNodeID(board),
                position: { ...mine.value.position },
                type: "resource",
                state: { type, amount }
            };
            board.placeInAvailableSpace(node);
            board.nodes.value.push(node);
        } else {
            const state = node.state as unknown as ResourceState;
            node.state = {
                ...state,
                amount: Decimal.add(state.amount, amount)
            } as unknown as State;
        }
    }

    // Amount of completions that could give you the exact average of each item without any partials
    const sumMineWeights = computed(() =>
        (Object.keys(mineLootTable) as Resources[]).reduce(
            (a, b) => a + new Decimal(dropRates[b].computedModifier.value).toNumber(),
            0
        )
    );

    const planarMultis = computed(() => {
        const multis: Partial<Record<Resources | "energy", DecimalSource>> = {};
        board.types.portal.nodes.value.forEach(n => {
            if (!isPowered(n)) {
                return;
            }
            const plane = layers[(n.state as unknown as PortalState).id] as GenericPlane;
            const planeMultis = plane.resourceMultis.value;
            (Object.keys(planeMultis) as (Resources | "energy")[]).forEach(type => {
                if (multis[type] != null) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    multis[type] = Decimal.times(multis[type]!, planeMultis[type]!);
                } else {
                    multis[type] = planeMultis[type];
                }
            });
        });
        return multis;
    });

    const energyModifier = createSequentialModifier(() => [
        ...resourceNames.map(resource =>
            createMultiplicativeModifier(() => ({
                description: () =>
                    `${camelToTitle(resource)} (Lv. ${formatWhole(
                        resourceLevels.value[resource]
                    )}) (${format(computedmaterialLevelEffectModifier.value)}x per level)`,
                multiplier: () =>
                    Decimal.pow(
                        computedmaterialLevelEffectModifier.value,
                        resourceLevels.value[resource]
                    ),
                enabled: () =>
                    resource in resourceNodes.value &&
                    Decimal.gt(
                        (resourceNodes.value[resource].state as ResourceState | undefined)
                            ?.amount ?? 0,
                        0
                    )
            }))
        ),
        createMultiplicativeModifier(() => ({
            multiplier: () =>
                empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("stone")
                    ? 4
                    : 2,
            description: () =>
                (empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("stone")
                    ? "Empowered "
                    : "") + tools.stone.name,
            enabled: () => toolNodes.value["stone"] != null
        })),
        createMultiplicativeModifier(() => ({
            multiplier: () => planarMultis.value.energy ?? 1,
            description: "Planar Treasures",
            enabled: () => Decimal.neq(planarMultis.value.energy ?? 1, 1)
        })),
        createAdditiveModifier(() => ({
            addend: () => Decimal.pow(100, poweredMachines.value).div(10).neg(),
            description: "Powered Machines (100^n/10 energy/s)",
            enabled: () => Decimal.gt(poweredMachines.value, 0)
        }))
    ]);
    const computedEnergyModifier = computed(() => energyModifier.apply(1));

    const miningSpeedModifier = createSequentialModifier(() => [
        createMultiplicativeModifier(() => ({
            multiplier: () =>
                empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("dirt")
                    ? 4
                    : 2,
            description: () =>
                (empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("dirt")
                    ? "Empowered "
                    : "") + tools.dirt.name,
            enabled: () => toolNodes.value["dirt"] != null
        }))
    ]);
    const computedMiningSpeedModifier = computed(() => miningSpeedModifier.apply(1));

    const materialGainModifier = createSequentialModifier(() => [
        createMultiplicativeModifier(() => ({
            multiplier: () =>
                empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("gravel")
                    ? 4
                    : 2,
            description: () =>
                (empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("gravel")
                    ? "Empowered "
                    : "") + tools.gravel.name,
            enabled: () => toolNodes.value["gravel"] != null
        }))
    ]);
    const computedMaterialGainModifier = computed(() => materialGainModifier.apply(1));

    const materialLevelEffectModifier = createSequentialModifier(() => [
        createAdditiveModifier(() => ({
            addend: () =>
                empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("copper")
                    ? 0.002
                    : 0.001,
            description: () =>
                (empowerer.value != null &&
                isPowered(empowerer.value) &&
                (empowerer.value.state as unknown as EmpowererState).tools.includes("copper")
                    ? "Empowered "
                    : "") + tools.copper.name,
            enabled: () => toolNodes.value["copper"] != null
        }))
    ]);
    const computedmaterialLevelEffectModifier = computed(() =>
        materialLevelEffectModifier.apply(1.01)
    );

    const dropRates = (Object.keys(mineLootTable) as Resources[]).reduce((acc, resource) => {
        const modifier = createSequentialModifier(() => [
            createMultiplicativeModifier(() => ({
                multiplier: 2,
                description: "Dowsing",
                enabled: () =>
                    dowsing.value != null &&
                    isPowered(dowsing.value) &&
                    (dowsing.value.state as unknown as DowsingState).resources.includes(resource)
            }))
        ]);
        const computedModifier = computed(() => modifier.apply(mineLootTable[resource]));
        const section = {
            title: `${camelToTitle(resource)} Drop Rate`,
            modifier,
            base: mineLootTable[resource]
        };
        acc[resource] = { modifier, computedModifier, section };
        return acc;
    }, {} as Record<Resources, { modifier: WithRequired<Modifier, "invert" | "description">; computedModifier: ComputedRef<DecimalSource>; section: Section }>);

    const resourceGain = (Object.keys(mineLootTable) as Resources[]).reduce((acc, resource) => {
        const modifier = createSequentialModifier(() => [
            createMultiplicativeModifier(() => ({
                multiplier: () => planarMultis.value[resource] ?? 1,
                description: "Planar Treasures",
                enabled: () => Decimal.neq(planarMultis.value[resource] ?? 1, 1)
            }))
        ]);
        const computedModifier = computed(() => modifier.apply(1));
        const section = {
            title: `${camelToTitle(resource)} Gain`,
            modifier
        };
        acc[resource] = { modifier, computedModifier, section };
        return acc;
    }, {} as Record<Resources, { modifier: WithRequired<Modifier, "invert" | "description">; computedModifier: ComputedRef<DecimalSource>; section: Section }>);

    const [energyTab, energyTabCollapsed] = createCollapsibleModifierSections(() => [
        {
            title: "Energy Gain",
            modifier: energyModifier,
            base: 1,
            unit: "/s"
        }
    ]);
    const [miningTab, miningTabCollapsed] = createCollapsibleModifierSections(() => [
        {
            title: "Mining Speed",
            modifier: miningSpeedModifier,
            base: 1,
            unit: "/s",
            visible: () => toolNodes.value["dirt"] != null
        },
        {
            title: "Ore Dropped",
            modifier: materialGainModifier,
            base: 1,
            visible: () => toolNodes.value["gravel"] != null
        },
        {
            title: "Material Level Effect",
            modifier: materialLevelEffectModifier,
            base: 1.01,
            visible: () => toolNodes.value["copper"] != null
        }
    ]);
    const [resourcesTab, resourcesCollapsed] = createCollapsibleModifierSections(() =>
        Object.values(dropRates).map(d => d.section)
    );
    const [resourceGainTab, resourceGainCollapsed] = createCollapsibleModifierSections(() =>
        Object.values(resourceGain).map(d => d.section)
    );
    const modifierTabs = createTabFamily({
        general: () => ({
            display: "Energy",
            glowColor(): string {
                return modifierTabs.activeTab.value === this.tab ? "white" : "";
            },
            tab: energyTab,
            energyTabCollapsed
        }),
        mining: () => ({
            display: "Mine",
            glowColor(): string {
                return modifierTabs.activeTab.value === this.tab ? "white" : "";
            },
            visibility: () => Object.keys(toolNodes.value).length > 0,
            tab: miningTab,
            miningTabCollapsed
        }),
        resources: () => ({
            display: "Mine Rates",
            glowColor(): string {
                return modifierTabs.activeTab.value === this.tab ? "white" : "";
            },
            visibility: () => dowsing.value != null,
            tab: resourcesTab,
            resourcesCollapsed
        }),
        resourcesGain: () => ({
            display: "Resource Gain",
            glowColor(): string {
                return modifierTabs.activeTab.value === this.tab ? "white" : "";
            },
            visibility: () =>
                Object.values(resourceGain).some(r => Decimal.neq(r.computedModifier.value, 1)),
            tab: resourceGainTab,
            resourceGainCollapsed
        })
    });
    const showModifiersModal = ref(false);
    const modifiersModal = jsx(() => (
        <Modal
            modelValue={showModifiersModal.value}
            onUpdate:modelValue={(value: boolean) => (showModifiersModal.value = value)}
            v-slots={{
                header: () => <h2>Modifiers</h2>,
                body: () => render(modifierTabs)
            }}
        />
    ));

    this.on("preUpdate", diff => {
        Object.keys(resourceMinedCooldown).forEach(resource => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            resourceMinedCooldown[resource as Resources]! -= diff;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (resourceMinedCooldown[resource as Resources]! <= 0) {
                delete resourceMinedCooldown[resource as Resources];
            }
        });
        Object.keys(resourceQuarriedCooldown).forEach(resource => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            resourceQuarriedCooldown[resource as Resources]! -= diff;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (resourceQuarriedCooldown[resource as Resources]! <= 0) {
                delete resourceQuarriedCooldown[resource as Resources];
            }
        });

        if (isPowered(mine.value)) {
            const progress = Decimal.add(
                (mine.value.state as unknown as MineState).progress,
                Decimal.times(computedMiningSpeedModifier.value, diff)
            );
            const completions = progress.floor();
            mine.value.state = {
                ...(mine.value.state as object),
                progress: Decimal.sub(progress, completions)
            };
            const allResourceCompletions = completions.div(sumMineWeights.value).floor();
            if (allResourceCompletions.gt(0)) {
                resourceNames.forEach(resource => {
                    grantResource(
                        resource,
                        Decimal.times(
                            new Decimal(dropRates[resource].computedModifier.value).toNumber(),
                            allResourceCompletions
                        ).times(computedMaterialGainModifier.value)
                    );
                    resourceMinedCooldown[resource] = 0.3;
                });
            }
            const remainder = Decimal.sub(completions, allResourceCompletions).toNumber();
            for (let i = 0; i < remainder; i++) {
                const random = Math.floor(Math.random() * sumMineWeights.value);
                let weight = 0;
                for (let i = 0; i < resourceNames.length; i++) {
                    const resource = resourceNames[i];
                    weight += new Decimal(dropRates[resource].computedModifier.value).toNumber();
                    if (random < weight) {
                        grantResource(resource, computedMaterialGainModifier.value);
                        resourceMinedCooldown[resource] = 0.3;
                        break;
                    }
                }
            }
        }

        if (quarry.value != null && isPowered(quarry.value)) {
            const { progress, resources } = quarry.value.state as unknown as QuarryState;
            if (resources.length > 0) {
                let newProgress = Decimal.add(progress, diff);
                const completions = Decimal.div(progress, quarryProgressRequired.value).floor();
                newProgress = Decimal.sub(
                    newProgress,
                    Decimal.times(completions, quarryProgressRequired.value)
                );
                quarry.value.state = { ...(quarry.value.state as object), progress: newProgress };
                if (Decimal.gt(completions, 0)) {
                    resources.forEach(resource => {
                        grantResource(resource, completions);
                        resourceQuarriedCooldown[resource] = 0.3;
                    });
                }
            }
        }

        energy.value = Decimal.add(energy.value, Decimal.times(computedEnergyModifier.value, diff));

        if (Decimal.lt(energy.value, 0)) {
            // Uh oh, time to de-power machines!
            energy.value = 0;
            mine.value.state = { ...(mine.value.state as object), powered: false };
            toast.warning(
                <div>
                    <h3>Ran out of energy!</h3>
                    <div>All machines have been turned off.</div>
                </div>
            );
        }
    });

    const energyChange = computed(() => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (board.selectedAction.value === board.types.brokenFactory.actions![0]) {
            return -100;
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (board.selectedAction.value === board.types.factory.actions![1]) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return Decimal.neg(tools[board.selectedNode.value!.state as Resources].cost);
        }
        if (board.selectedAction.value?.id === "moreConnections") {
            return Decimal.neg(
                (
                    board.selectedAction.value as unknown as { formula: GenericFormula }
                ).formula.evaluate(
                    (board.selectedNode.value?.state as unknown as { maxConnections: number })
                        .maxConnections
                )
            );
        }
        return 0;
    });
    const energyPreview = createFormulaPreview(
        Formula.variable(0).add(energy),
        () => Decimal.neq(energyChange.value, 0),
        energyChange
    );

    const energyProductionChange = computed(() => {
        if (board.selectedAction.value === togglePoweredAction) {
            return (board.selectedNode.value?.state as { powered: boolean }).powered
                ? Decimal.eq(poweredMachines.value, 1)
                    ? 10
                    : Decimal.pow(100, poweredMachines.value).div(10).times(0.99)
                : Decimal.neg(nextPowerCost.value);
        }
        return 0;
    });
    const energyProductionPreview = createFormulaPreview(
        Formula.variable(0).add(computedEnergyModifier),
        () => Decimal.neq(energyProductionChange.value, 0),
        energyProductionChange
    );

    const activePortals = computed(() => board.types.portal.nodes.value.filter(n => isPowered(n)));

    watch(activePortals, activePortals => {
        nextTick(() => {
            player.tabs = [
                "main",
                ...activePortals.map(node => (node.state as unknown as PortalState).id)
            ];
        });
    });

    return {
        name: "World",
        board,
        energy,
        modifierTabs,
        mineLootTable,
        tools,
        passives,
        resourceNodes,
        toolNodes,
        grantResource,
        activePortals,
        display: jsx(() => (
            <>
                <StickyVue class="nav-container">
                    <span class="nav-segment">
                        <h2 style="color: white; text-shadow: 0px 0px 10px white;">
                            {render(energyPreview)}
                        </h2>{" "}
                        energy
                    </span>
                    <span class="nav-segment">
                        (
                        <h3 style="color: white; text-shadow: 0px 0px 10px white;">
                            {Decimal.gt(computedEnergyModifier.value, 0) ? "+" : ""}
                            {render(energyProductionPreview)}
                        </h3>
                        /s)
                    </span>
                    {Decimal.gt(poweredMachines.value, 0) ? (
                        <span class="nav-segment">
                            <h3 style="color: var(--accent1); text-shadow: 0px 0px 10px var(--accent1);">
                                {formatWhole(poweredMachines.value)}
                            </h3>{" "}
                            machines powered
                        </span>
                    ) : null}
                    <span class="nav-segment">
                        <button
                            class="button"
                            style="display: inline"
                            onClick={() => (showModifiersModal.value = true)}
                        >
                            open modifiers
                        </button>
                    </span>
                    {player.devSpeed === 0 ? (
                        <span class="nav-segment">Game Paused</span>
                    ) : player.devSpeed != null && player.devSpeed !== 1 ? (
                        <span class="nav-segment">Dev Speed: {format(player.devSpeed)}x</span>
                    ) : null}
                </StickyVue>
                {render(board)}
                {render(modifiersModal)}
            </>
        ))
    };
});

/**
 * Given a player save data object being loaded, return a list of layers that should currently be enabled.
 * If your project does not use dynamic layers, this should just return all layers.
 */
export const getInitialLayers = (
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    player: Partial<Player>
): Array<GenericLayer> => {
    const layers: GenericLayer[] = [main];
    let id = 0;
    while (`portal-${id}` in (player.layers ?? {})) {
        const layer = player.layers?.[`portal-${id}`] as LayerData<GenericPlane>;
        layers.push(
            createPlane(
                `portal-${id}`,
                layer.tier ?? "dirt",
                layer.seed ?? Math.floor(Math.random() * 4294967296)
            )
        );
        id++;
    }
    return layers;
};

/**
 * A computed ref whose value is true whenever the game is over.
 */
export const hasWon = computed(() => {
    return false;
});

/**
 * Given a player save data object being loaded with a different version, update the save data object to match the structure of the current version.
 * @param oldVersion The version of the save being loaded in
 * @param player The save data being loaded in
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
export function fixOldSave(
    oldVersion: string | undefined,
    player: Partial<Player>
    // eslint-disable-next-line @typescript-eslint/no-empty-function
): void {}
/* eslint-enable @typescript-eslint/no-unused-vars */
