import {
    BoardNode,
    GenericBoard,
    NodeTypeOptions,
    ProgressDisplay,
    Shape,
    getUniqueNodeID
} from "features/boards/board";
import { addLayer, layers, removeLayer } from "game/layers";
import player from "game/player";
import Decimal from "lib/break_eternity";
import { format, formatWhole } from "util/break_eternity";
import { camelToTitle } from "util/common";
import {
    canAcceptPortal,
    canAcceptResource,
    canAcceptTool,
    deselectAllAction,
    getIncreaseConnectionsAction,
    getResourceLevelProgress,
    isEmpowered,
    isPowered,
    labelForAcceptingPortal,
    labelForAcceptingResource,
    labelForAcceptingTool,
    onDropPortal,
    onDropResource,
    onDropTool,
    togglePoweredAction
} from "./boardUtils";
import {
    AutomatorState,
    BoosterState,
    DowsingState,
    EmpowererState,
    InfluenceState,
    InvestmentsState,
    MineState,
    Passives,
    PortalGeneratorState,
    PortalState,
    QuarryState,
    ResourceState,
    Resources,
    UpgraderState,
    increaseBoostFormula,
    influences,
    passives,
    relics,
    resourceNames,
    tools
} from "./data";
import { GenericPlane, createPlane } from "./planes";
import { main } from "./projEntry";

export const mine = {
    shape: Shape.Diamond,
    size: 50,
    title: "🪨",
    label: node =>
        node === main.board.selectedNode.value
            ? { text: "Mining" }
            : Object.keys(main.resourceNodes.value).length === 0
            ? { text: "Click me!" }
            : null,
    actionDistance: Math.PI / 4,
    actions: [togglePoweredAction],
    progress: node =>
        isPowered(node) ? new Decimal((node.state as unknown as MineState).progress).toNumber() : 0,
    progressDisplay: ProgressDisplay.Outline,
    progressColor: "var(--accent2)",
    classes: node => ({
        running: isPowered(node)
    }),
    draggable: true
} as NodeTypeOptions;

export const brokenFactory = {
    shape: Shape.Diamond,
    size: 50,
    title: "🛠️",
    label: node => (node === main.board.selectedNode.value ? { text: "Broken Forge" } : null),
    actionDistance: Math.PI / 4,
    actions: [
        {
            id: "repair",
            icon: "build",
            tooltip: { text: "Repair - 100 energy" },
            onClick(node) {
                if (Decimal.gte(main.energy.value, 100)) {
                    node.type = "factory";
                    main.energy.value = Decimal.sub(main.energy.value, 100);
                }
            },
            confirmationLabel: () =>
                Decimal.gte(main.energy.value, 1000)
                    ? { text: "Tap again to confirm" }
                    : { text: "Cannot afford", color: "var(--danger)" }
        }
    ],
    draggable: true
} as NodeTypeOptions;

export const factory = {
    shape: Shape.Diamond,
    size: 50,
    title: "🛠️",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    node.state == null
                        ? "Forge - Drag a resource to me!"
                        : `Forging ${tools[node.state as Resources].name}`
            };
        }
        if ((main.board as GenericBoard).draggingNode.value?.type === "resource") {
            const resource = (
                (main.board as GenericBoard).draggingNode.value?.state as unknown as ResourceState
            ).type;
            const text =
                node.state === resource
                    ? "Disconnect"
                    : main.toolNodes.value[resource] == null
                    ? tools[resource].name
                    : "Already crafted";
            const color =
                node.state === resource || main.toolNodes.value[resource] == null
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
                main.board.selectedAction.value = null;
                main.board.selectedNode.value = null;
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
                    Decimal.gte(main.energy.value, tool.cost) &&
                    main.toolNodes.value[node.state as Resources] == null
                ) {
                    main.energy.value = Decimal.sub(main.energy.value, tool.cost);
                    const newNode = {
                        id: getUniqueNodeID(main.board as GenericBoard),
                        position: { ...node.position },
                        type: tool.type,
                        state: "state" in tool ? tool.state : undefined
                    };
                    main.board.placeInAvailableSpace(newNode);
                    main.board.nodes.value.push(newNode);
                    if (node.state === "iron") {
                        const newNode = {
                            id: getUniqueNodeID(main.board as GenericBoard),
                            position: { ...node.position },
                            type: "trashCan"
                        };
                        main.board.placeInAvailableSpace(newNode);
                        main.board.nodes.value.push(newNode);
                    }
                    main.board.selectedAction.value = null;
                    main.board.selectedNode.value = null;
                    node.state = undefined;
                }
            },
            fillColor: node =>
                Decimal.gte(main.energy.value, tools[node.state as Resources].cost) &&
                main.toolNodes.value[node.state as Resources] == null
                    ? "var(--accent2)"
                    : "var(--danger)",
            visibility: node => node.state != null,
            confirmationLabel: node =>
                Decimal.gte(main.energy.value, tools[node.state as Resources].cost)
                    ? main.toolNodes.value[node.state as Resources] == null
                        ? { text: "Tap again to confirm" }
                        : { text: "Already crafted", color: "var(--danger)" }
                    : { text: "Cannot afford", color: "var(--danger)" }
        }
    ],
    progress: node =>
        node.state == null || main.toolNodes.value[node.state as Resources] != null
            ? 0
            : Decimal.div(
                  Decimal.sqrt(main.energy.value),
                  Decimal.sqrt(tools[node.state as Resources].cost)
              )
                  .clampMax(1)
                  .toNumber(),
    progressDisplay: ProgressDisplay.Fill,
    progressColor: node =>
        node.state != null && Decimal.gte(main.energy.value, tools[node.state as Resources].cost)
            ? "var(--accent2)"
            : "var(--foreground)",
    canAccept(node, otherNode) {
        if (otherNode.type !== "resource") {
            return false;
        }
        const resource = (
            (main.board as GenericBoard).draggingNode.value?.state as unknown as ResourceState
        ).type;
        return main.toolNodes.value[resource] == null;
    },
    onDrop(node, otherNode) {
        const droppedType = (otherNode.state as unknown as ResourceState).type;
        if (node.state === droppedType) {
            node.state = undefined;
        } else {
            node.state = droppedType;
        }
        main.board.selectedNode.value = node;
    },
    draggable: true
} as NodeTypeOptions;

const romanNumerals = [
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "XI",
    "XII",
    "XIII",
    "XIV",
    "XV",
    "XVI"
];
export const resource = {
    shape: Shape.Circle,
    size: 50,
    title: node =>
        camelToTitle((node.state as unknown as ResourceState).type) +
        " (" +
        romanNumerals[resourceNames.indexOf((node.state as unknown as ResourceState).type)] +
        ")",
    subtitle: node => formatWhole((node.state as unknown as ResourceState).amount),
    progress: node => getResourceLevelProgress((node.state as unknown as ResourceState).type),
    // Make clicking resources a no-op so they can't be selected
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onClick() {},
    progressDisplay: ProgressDisplay.Outline,
    progressColor: "var(--accent3)",
    classes: node => ({
        "affected-node":
            (main.dowsing.value != null &&
                isPowered(main.dowsing.value) &&
                (main.dowsing.value.state as unknown as DowsingState).resources.includes(
                    (node.state as unknown as ResourceState).type
                )) ||
            Decimal.neq(
                main.planarMultis.value[(node.state as unknown as ResourceState).type] ?? 1,
                1
            )
    }),
    draggable: true
} as NodeTypeOptions;

export const passive = {
    shape: Shape.Circle,
    size: 50,
    title: node => {
        const passive = node.state as Passives;
        if (passive.includes("Relic")) {
            return relics[passive.slice(0, -5) as Resources];
        }
        return tools[passive as Resources].name;
    },
    label: node =>
        node === main.board.selectedNode.value
            ? {
                  text: passives[node.state as Passives].description(
                      isEmpowered(node.state as Passives)
                  )
              }
            : null,
    outlineColor: "var(--bought)",
    classes: node => ({
        "affected-node": isEmpowered(node.state as Passives)
    }),
    draggable: true
} as NodeTypeOptions;

export const dowsing = {
    shape: Shape.Diamond,
    size: 50,
    title: "🥢",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as DowsingState).resources.length === 0
                        ? "Dowsing - Drag a resource to me!"
                        : `Dowsing (${
                              (node.state as { resources: Resources[] }).resources.length
                          }/${Decimal.add(
                              (node.state as { maxConnections: number }).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
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
} as NodeTypeOptions;

export const quarry = {
    shape: Shape.Diamond,
    size: 50,
    title: "⛏️",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as DowsingState).resources.length === 0
                        ? "Quarry - Drag a resource to me!"
                        : `Quarrying (${
                              (node.state as { resources: Resources[] }).resources.length
                          }/${Decimal.add(
                              (node.state as { maxConnections: number }).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
            };
        }
        return labelForAcceptingResource(
            node,
            resource =>
                `Gather ${format(
                    Decimal.div(main.dropRates[resource].computedModifier.value, 100)
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
            ? Decimal.eq(main.quarryProgressRequired.value, 0)
                ? 0
                : new Decimal((node.state as unknown as QuarryState).progress)
                      .div(main.quarryProgressRequired.value)
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
} as NodeTypeOptions;

export const empowerer = {
    shape: Shape.Diamond,
    size: 50,
    title: "🔌",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as EmpowererState).tools.length === 0
                        ? "Empowerer - Drag a tool to me!"
                        : `Empowering (${
                              (node.state as { tools: Passives[] }).tools.length
                          }/${Decimal.add(
                              (node.state as { maxConnections: number }).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
            };
        }
        return labelForAcceptingTool(node, passive => {
            if (passive.includes("Relic")) {
                return `Double ${relics[passive.slice(0, -5) as Resources]}'s effect`;
            }
            return `Double ${tools[passive as Resources].name}'s effect`;
        });
    },
    actionDistance: Math.PI / 4,
    actions: [
        deselectAllAction,
        getIncreaseConnectionsAction(x => x.add(3).pow_base(1000), 24),
        togglePoweredAction
    ],
    canAccept: canAcceptTool,
    onDrop: onDropTool,
    classes: node => ({
        running: isPowered(node)
    }),
    draggable: true
} as NodeTypeOptions;

export const portalGenerator = {
    shape: Shape.Diamond,
    size: 50,
    title: "⛩️",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as PortalGeneratorState).tier == null
                        ? "Portal Spawner - Drag a resource to me!"
                        : `Spawning ${
                              (node.state as unknown as PortalGeneratorState).tier
                          }-tier portal`
            };
        }
        const draggingNode = (main.board as GenericBoard).draggingNode.value;
        if (draggingNode?.type === "resource") {
            const resource = (draggingNode.state as unknown as ResourceState).type;
            const text =
                (node.state as unknown as PortalGeneratorState).tier === resource
                    ? "Disconnect"
                    : `${camelToTitle(resource)}-tier Portal`;
            return {
                text,
                color: "var(--accent2)"
            };
        } else if (draggingNode?.type === "influence") {
            const influence = (draggingNode.state as unknown as InfluenceState).type;
            const { influences } = node.state as unknown as PortalGeneratorState;
            if (influences.includes(influence)) {
                return { text: "Disconnect", color: "var(--accent2)" };
            }
            return {
                text: "Add influence",
                color: "var(--accent2)"
            };
        } else if (draggingNode?.type === "portal") {
            const portal = layers[
                (draggingNode.state as unknown as PortalState).id
            ] as GenericPlane;
            return { text: `Copy tier/influences from ${portal.name}` };
        }
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
                main.board.selectedAction.value = null;
                main.board.selectedNode.value = null;
            },
            visibility: (node: BoardNode) => {
                const { tier, influences } = node.state as unknown as PortalGeneratorState;
                return tier != null || influences.length > 0;
            }
        },
        {
            id: "makePortal",
            icon: "done",
            tooltip: node => ({
                text: `Spawn ${
                    (node.state as unknown as PortalGeneratorState).tier
                }-tier portal - ${formatWhole(main.computedPortalCost.value)} energy`
            }),
            fillColor: () =>
                Decimal.gte(main.energy.value, main.computedPortalCost.value)
                    ? "var(--accent2)"
                    : "var(--danger)",
            confirmationLabel: () =>
                Decimal.gte(main.energy.value, main.computedPortalCost.value)
                    ? { text: "Tap again to confirm" }
                    : { text: "Cannot afford", color: "var(--danger)" },
            onClick(node) {
                if (Decimal.lt(main.energy.value, main.computedPortalCost.value)) {
                    return;
                }
                let id = 0;
                while (`portal-${id}` in layers) {
                    id++;
                }
                main.energy.value = Decimal.sub(main.energy.value, main.computedPortalCost.value);
                const { tier, influences } = node.state as unknown as PortalGeneratorState;
                addLayer(
                    createPlane(
                        `portal-${id}`,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        tier!,
                        Math.floor(Math.random() * 4294967296),
                        influences.map(
                            influence =>
                                main.influenceNodes.value[influence]
                                    .state as unknown as InfluenceState
                        )
                    ),
                    player
                );
                const newNode = {
                    id: getUniqueNodeID(main.board as GenericBoard),
                    position: { ...node.position },
                    type: "portal",
                    state: { id: `portal-${id}`, powered: false }
                };
                main.board.placeInAvailableSpace(newNode);
                main.board.nodes.value.push(newNode);
                main.board.selectedAction.value = null;
                main.board.selectedNode.value = null;
                node.state = { tier: undefined, influences: [] };
            },
            visibility: node => (node.state as unknown as PortalGeneratorState).tier != null
        }
    ],
    canAccept(node, otherNode) {
        return (
            otherNode.type === "resource" ||
            otherNode.type === "influence" ||
            otherNode.type === "portal"
        );
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
            const droppedInfluence = (otherNode.state as unknown as InfluenceState).type;
            const currentInfluences = (node.state as unknown as PortalGeneratorState).influences;
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
        } else if (otherNode.type === "portal") {
            const portal = layers[(otherNode.state as unknown as PortalState).id] as GenericPlane;
            node.state = {
                ...(node.state as object),
                tier: portal.tier.value,
                influences: (portal.influences.value as unknown as InfluenceState[]).map(
                    influence => influence.type
                )
            };
        }
        main.board.selectedNode.value = node;
    },
    progress: node =>
        (node.state as unknown as PortalGeneratorState).tier == null
            ? 0
            : Decimal.div(
                  Decimal.sqrt(main.energy.value),
                  Decimal.sqrt(main.computedPortalCost.value)
              )
                  .clampMax(1)
                  .toNumber(),
    progressDisplay: ProgressDisplay.Fill,
    progressColor: node =>
        (node.state as unknown as PortalGeneratorState).tier != null &&
        Decimal.gte(main.energy.value, main.computedPortalCost.value)
            ? "var(--accent2)"
            : "var(--foreground)",
    draggable: true
} as NodeTypeOptions;

export const portal = {
    shape: Shape.Diamond,
    size: 50,
    title: "🌀",
    label: node =>
        node === main.board.selectedNode.value
            ? {
                  text: `Portal to ${
                      (layers[(node.state as unknown as PortalState).id] as GenericPlane).name
                  }`,
                  color: (layers[(node.state as unknown as PortalState).id] as GenericPlane).color
              }
            : null,
    actionDistance: Math.PI / 4,
    actions: [togglePoweredAction],
    classes: node => ({
        running: isPowered(node),
        showNotif: (layers[(node.state as unknown as PortalState).id] as GenericPlane).showNotif
            .value,
        "affected-node":
            main.booster.value != null &&
            isPowered(main.booster.value) &&
            (main.booster.value.state as unknown as BoosterState).portals.includes(
                (node.state as unknown as PortalState).id
            )
    }),
    outlineColor: node =>
        (layers[(node.state as unknown as PortalState).id] as GenericPlane).background,
    draggable: true
} as NodeTypeOptions;

export const influence = {
    shape: node =>
        (node.state as unknown as InfluenceState).type === "increaseResources" ||
        (node.state as unknown as InfluenceState).type === "decreaseResources"
            ? Shape.Diamond
            : Shape.Circle,
    size: 50,
    title: node => influences[(node.state as unknown as InfluenceState).type].display,
    label: node => {
        if (node === main.board.selectedNode.value) {
            const state = node.state as unknown as InfluenceState;
            const desc = influences[state.type].description;
            return { text: typeof desc === "function" ? desc(state) : desc };
        }
        const draggingNode = (main.board as GenericBoard).draggingNode.value;
        if (draggingNode?.type === "resource") {
            const resource = (draggingNode.state as unknown as ResourceState).type;
            const { type, data } = node.state as unknown as InfluenceState;
            let text;
            if (Array.isArray(data) && data.includes(resource)) {
                text = "Disconnect";
            } else if (type === "increaseResources") {
                text = `Increase ${camelToTitle(resource)} odds`;
            } else if (type === "decreaseResources") {
                text = `Decrease ${camelToTitle(resource)} odds`;
            } else {
                return null;
            }
            return {
                text,
                color: "var(--accent2)"
            };
        }
        return null;
    },
    actionDistance: Math.PI / 4,
    actions: [deselectAllAction],
    canAccept: (node, otherNode) => {
        if (otherNode.type !== "resource") {
            return false;
        }
        return Array.isArray((node.state as unknown as InfluenceState).data);
    },
    onDrop: (node, otherNode) => {
        if (otherNode.type !== "resource") {
            return;
        }
        const resource = (otherNode.state as unknown as ResourceState).type;
        const resources = (node.state as unknown as InfluenceState).data as Resources[] | undefined;
        if (resources == null) {
            return;
        }
        if (resources.includes(resource)) {
            node.state = {
                ...(node.state as object),
                data: resources.filter(r => r !== resource)
            };
        } else {
            node.state = { ...(node.state as object), data: [...resources, resource] };
        }
        main.board.selectedNode.value = node;
    },
    outlineColor: "var(--danger)",
    draggable: true
} as NodeTypeOptions;

export const booster = {
    shape: Shape.Diamond,
    size: 50,
    title: "⌛",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as BoosterState).portals.length === 0
                        ? "Booster - Drag a portal to me!"
                        : `Boosting by ${formatWhole(
                              Decimal.add(1, (node.state as unknown as BoosterState).level)
                          )}x (${
                              (node.state as unknown as BoosterState).portals.length
                          }/${Decimal.add(
                              (node.state as unknown as BoosterState).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
            };
        }
        return labelForAcceptingPortal(node, portal => {
            return `Boost ${(layers[portal] as GenericPlane).name}'s speed`;
        });
    },
    actionDistance: Math.PI / 4,
    actions: [
        deselectAllAction,
        getIncreaseConnectionsAction(x => x.add(6).pow_base(1000)),
        {
            id: "increaseBoost",
            icon: "arrow_upward",
            tooltip(node: BoardNode) {
                return {
                    text: `Increase boost - ${formatWhole(
                        increaseBoostFormula.evaluate((node.state as unknown as BoosterState).level)
                    )} energy`
                };
            },
            fillColor(node: BoardNode) {
                return Decimal.gte(
                    main.energy.value,
                    increaseBoostFormula.evaluate((node.state as unknown as BoosterState).level)
                )
                    ? "var(--bought)"
                    : "var(--locked)";
            },
            confirmationLabel(node: BoardNode) {
                return Decimal.gte(
                    main.energy.value,
                    increaseBoostFormula.evaluate((node.state as unknown as BoosterState).level)
                )
                    ? { text: "Tap again to confirm" }
                    : { text: "Cannot afford", color: "var(--danger)" };
            },
            onClick(node: BoardNode) {
                const cost = increaseBoostFormula.evaluate(
                    (node.state as unknown as BoosterState).level
                );
                if (Decimal.gte(main.energy.value, cost)) {
                    main.energy.value = Decimal.sub(main.energy.value, cost);
                    node.state = {
                        ...(node.state as object),
                        level: Decimal.add((node.state as unknown as BoosterState).level, 1)
                    };
                    main.board.selectedAction.value = null;
                }
            }
        },
        togglePoweredAction
    ],
    canAccept: canAcceptPortal,
    onDrop: onDropPortal,
    classes: node => ({
        running: isPowered(node)
    }),
    draggable: true
} as NodeTypeOptions;

export const upgrader = {
    shape: Shape.Diamond,
    size: 50,
    title: "🤖",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as UpgraderState).portals.length === 0
                        ? "Upgrader - Drag a portal to me!"
                        : `Auto-Upgrading (${
                              (node.state as unknown as UpgraderState).portals.length
                          }/${Decimal.add(
                              (node.state as unknown as UpgraderState).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
            };
        }
        return labelForAcceptingPortal(node, portal => {
            return `Auto-buy ${(layers[portal] as GenericPlane).name}'s upgrades and prestiges`;
        });
    },
    actionDistance: Math.PI / 4,
    actions: [
        deselectAllAction,
        getIncreaseConnectionsAction(x => x.add(4).pow_base(1e6)),
        togglePoweredAction
    ],
    canAccept: canAcceptPortal,
    onDrop: onDropPortal,
    classes: node => ({
        running: isPowered(node)
    }),
    draggable: true
} as NodeTypeOptions;

export const automator = {
    shape: Shape.Diamond,
    size: 50,
    title: "🦾",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as AutomatorState).portals.length === 0
                        ? "Automator - Drag a portal to me!"
                        : `Automatating (${
                              (node.state as unknown as AutomatorState).portals.length
                          }/${Decimal.add(
                              (node.state as unknown as AutomatorState).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
            };
        }
        return labelForAcceptingPortal(node, portal => {
            return `Auto-buy ${(layers[portal] as GenericPlane).name}'s repeatables and dimensions`;
        });
    },
    actionDistance: Math.PI / 4,
    actions: [
        deselectAllAction,
        getIncreaseConnectionsAction(x => x.add(4).pow_base(1e6)),
        togglePoweredAction
    ],
    canAccept: canAcceptPortal,
    onDrop: onDropPortal,
    classes: node => ({
        running: isPowered(node)
    }),
    draggable: true
} as NodeTypeOptions;

export const investments = {
    shape: Shape.Diamond,
    size: 50,
    title: "💱",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text:
                    (node.state as unknown as InvestmentsState).portals.length === 0
                        ? "Investments - Drag a portal to me!"
                        : `Investing (${
                              (node.state as unknown as InvestmentsState).portals.length
                          }/${Decimal.add(
                              (node.state as unknown as InvestmentsState).maxConnections,
                              main.computedBonusConnectionsModifier.value
                          )})`
            };
        }
        return labelForAcceptingPortal(node, portal => {
            return `Passively generate ${(layers[portal] as GenericPlane).name}'s conversions`;
        });
    },
    actionDistance: Math.PI / 4,
    actions: [
        deselectAllAction,
        getIncreaseConnectionsAction(x => x.add(3).pow_base(1e8)),
        togglePoweredAction
    ],
    canAccept: canAcceptPortal,
    onDrop: onDropPortal,
    classes: node => ({
        running: isPowered(node)
    }),
    draggable: true
} as NodeTypeOptions;

export const trashCan = {
    shape: Shape.Diamond,
    size: 50,
    title: "🗑️",
    label: node => {
        if (node === main.board.selectedNode.value) {
            return {
                text: "Trash Can - Drag a portal to me!"
            };
        }
        if (main.board.draggingNode.value?.type === "portal") {
            const portal = (main.board.draggingNode.value.state as unknown as PortalState).id;
            return {
                text: `Delete ${(layers[portal] as GenericPlane).name}!`,
                color: "var(--danger)"
            };
        }
        return null;
    },
    canAccept: (node: BoardNode, otherNode: BoardNode) => {
        return otherNode.type === "portal";
    },
    onDrop: (node, otherNode) => {
        const portal = (otherNode.state as unknown as PortalState).id;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        removeLayer(layers[portal]!);
        delete player.layers[portal];
        main.board.state.value.nodes = main.board.state.value.nodes.filter(
            node => node !== otherNode
        );
        if (main.booster.value) {
            main.booster.value.state = {
                ...(main.booster.value.state as object),
                portals: (main.booster.value.state as unknown as BoosterState).portals.filter(
                    p => p !== portal
                )
            };
        }
        if (main.upgrader.value) {
            main.upgrader.value.state = {
                ...(main.upgrader.value.state as object),
                portals: (main.upgrader.value.state as unknown as BoosterState).portals.filter(
                    p => p !== portal
                )
            };
        }
        if (main.automator.value) {
            main.automator.value.state = {
                ...(main.automator.value.state as object),
                portals: (main.automator.value.state as unknown as BoosterState).portals.filter(
                    p => p !== portal
                )
            };
        }
        if (main.investments.value) {
            main.investments.value.state = {
                ...(main.investments.value.state as object),
                portals: (main.investments.value.state as unknown as BoosterState).portals.filter(
                    p => p !== portal
                )
            };
        }
    },
    draggable: true
} as NodeTypeOptions;
