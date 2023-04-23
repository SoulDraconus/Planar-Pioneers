import Modal from "components/Modal.vue";
import StickyVue from "components/layout/Sticky.vue";
import {
    BoardNode,
    GenericBoard,
    ProgressDisplay,
    Shape,
    createBoard,
    getUniqueNodeID
} from "features/boards/board";
import { jsx } from "features/feature";
import { createResource } from "features/resources/resource";
import { createTabFamily } from "features/tabs/tabFamily";
import Formula, { calculateCost } from "game/formulas/formulas";
import type { BaseLayer, GenericLayer } from "game/layers";
import { createLayer } from "game/layers";
import {
    createAdditiveModifier,
    createMultiplicativeModifier,
    createSequentialModifier
} from "game/modifiers";
import { State, persistent } from "game/persistence";
import type { Player } from "game/player";
import player from "game/player";
import settings from "game/settings";
import Decimal, { DecimalSource } from "lib/break_eternity";
import { format, formatWhole } from "util/bignum";
import { camelToTitle } from "util/common";
import { render } from "util/vue";
import { ComputedRef, computed, nextTick, reactive, ref, watch } from "vue";
import { useToast } from "vue-toastification";
import { createCollapsibleModifierSections, createFormulaPreview } from "./common";
import "./main.css";

const toast = useToast();

export interface ResourceState {
    type: Resources;
    amount: DecimalSource;
}

const mineLootTable = {
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
        type: "dowsing"
    },
    gravel: {
        cost: 1e5,
        name: "Ore Processor",
        type: "passive",
        state: "gravel"
    },
    wood: {
        cost: 1e6,
        name: "Unknown Item", // (action node)
        type: "unknownType"
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
        type: "empowerer"
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
        type: "portalGenerator"
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
        description: "Doubles mining speed"
    },
    gravel: {
        description: "Doubles material drops"
    },
    stone: {
        description: "Doubles energy gain"
    },
    copper: {
        description: "Material level is 10% stronger"
    }
} as const;

export type Passives = keyof typeof passives;

/**
 * @hidden
 */
export const main = createLayer("main", function (this: BaseLayer) {
    const energy = createResource<DecimalSource>(0, "energy");
    const hasForged = persistent<boolean>(false);

    const resourceLevelFormula = Formula.variable(0).add(1);

    const resourceNodes: ComputedRef<Record<Resources, BoardNode>> = computed(() =>
        board.types.resource.nodes.value.reduce((acc, curr) => {
            acc[(curr.state as unknown as ResourceState).type] = curr;
            return acc;
        }, {} as Record<Resources, BoardNode>)
    );

    const toolNodes: ComputedRef<Record<Resources, BoardNode>> = computed(() =>
        // TODO add non-passive tools
        board.types.passive.nodes.value.reduce((acc, curr) => {
            acc[curr.state as Resources] = curr;
            return acc;
        }, {} as Record<Resources, BoardNode>)
    );

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

    const board = createBoard(board => ({
        startNodes: () => [
            { position: { x: 0, y: 0 }, type: "mine", state: 0 },
            { position: { x: 0, y: -200 }, type: "brokenFactory" }
        ],
        types: {
            mine: {
                shape: Shape.Diamond,
                size: 50,
                title: "🪨",
                label: node =>
                    node === board.selectedNode.value
                        ? { text: "Mining..." }
                        : Object.keys(resourceNodes.value).length === 0
                        ? { text: "Click me!" }
                        : null,
                progress: node =>
                    node == board.selectedNode.value
                        ? new Decimal(node.state as DecimalSource).toNumber()
                        : 0,
                progressDisplay: ProgressDisplay.Outline,
                progressColor: "var(--accent2)",
                classes: node => ({ running: node === board.selectedNode.value }),
                draggable: true
            },
            brokenFactory: {
                shape: Shape.Diamond,
                size: 50,
                title: "🛠️",
                label: node =>
                    node === board.selectedNode.value ? { text: "Broken Forge" } : null,
                actionDistance: 100,
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
                label: node =>
                    node === board.selectedNode.value
                        ? {
                              text:
                                  node.state == null
                                      ? hasForged.value
                                          ? "Forge"
                                          : "Forge - Drag a material to me!"
                                      : `Forge - ${tools[node.state as Resources].name} selected`
                          }
                        : (board as GenericBoard).draggingNode.value?.type === "resource"
                        ? {
                              text: tools[
                                  (
                                      (board as GenericBoard).draggingNode.value
                                          ?.state as unknown as ResourceState
                                  ).type
                              ].name,
                              color:
                                  Decimal.gte(
                                      energy.value,
                                      tools[
                                          (
                                              (board as GenericBoard).draggingNode.value
                                                  ?.state as unknown as ResourceState
                                          ).type
                                      ].cost
                                  ) &&
                                  !(
                                      (
                                          (board as GenericBoard).draggingNode.value
                                              ?.state as unknown as ResourceState
                                      ).type in toolNodes.value
                                  )
                                      ? "var(--accent2)"
                                      : "var(--danger)"
                          }
                        : null,
                actionDistance: 100,
                actions: [
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
                                !((node.state as Resources) in toolNodes.value)
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
                            }
                        },
                        fillColor: node =>
                            Decimal.gte(energy.value, tools[node.state as Resources].cost) &&
                            !((node.state as Resources) in toolNodes.value)
                                ? "var(--accent2)"
                                : "var(--danger)",
                        visibility: node => node.state != null,
                        confirmationLabel: node =>
                            Decimal.gte(energy.value, tools[node.state as Resources].cost)
                                ? !((node.state as Resources) in toolNodes.value)
                                    ? { text: "Tap again to confirm" }
                                    : { text: "Already crafted", color: "var(--danger)" }
                                : { text: "Cannot afford", color: "var(--danger)" }
                    },
                    {
                        id: "deselect",
                        icon: "close",
                        tooltip: { text: "De-select material" },
                        onClick(node) {
                            node.state = undefined;
                            board.selectedAction.value = null;
                            board.selectedNode.value = null;
                        },
                        visibility: node => node.state != null
                    }
                ],
                canAccept(node, otherNode) {
                    return otherNode.type === "resource";
                },
                onDrop(node, otherNode) {
                    node.state = (otherNode.state as unknown as ResourceState).type;
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
                draggable: true
            },
            passive: {
                shape: Shape.Circle,
                size: 50,
                title: node => tools[node.state as Resources].name,
                label: node =>
                    node === board.selectedNode.value
                        ? {
                              text: passives[node.state as Passives].description
                          }
                        : null,
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
            const mine = board.nodes.value.find(n => n.type === "mine") as BoardNode;
            const links = Object.keys(resourceMinedCooldown).map(resource => ({
                startNode: mine,
                endNode: resourceNodes.value[resource as Resources],
                stroke: "var(--accent3)",
                strokeWidth: 5
            }));
            const factory = board.nodes.value.find(n => n.type === "factory");
            if (factory != null && factory.state != null) {
                links.push({
                    startNode: factory,
                    endNode: resourceNodes.value[factory.state as Resources],
                    stroke: "var(--foreground)",
                    strokeWidth: 4
                });
            }
            return links;
        }
    }));

    function grantResource(type: Resources, amount: DecimalSource) {
        let node = resourceNodes.value[type];
        if (node == null) {
            const mine = board.nodes.value.find(n => n.type === "mine") as BoardNode;
            node = {
                id: getUniqueNodeID(board),
                position: { ...mine.position },
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
    const sumMineWeights = (Object.values(mineLootTable) as number[]).reduce((a, b) => a + b);
    const resourceNames = Object.keys(mineLootTable) as Resources[];

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
            multiplier: 2,
            description: tools.stone.name,
            enabled: () => "stone" in toolNodes.value
        }))
    ]);
    const computedEnergyModifier = computed(() => energyModifier.apply(1));

    const miningSpeedModifier = createSequentialModifier(() => [
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: tools.dirt.name,
            enabled: () => "dirt" in toolNodes.value
        }))
    ]);
    const computedMiningSpeedModifier = computed(() => miningSpeedModifier.apply(1));

    const materialGainModifier = createSequentialModifier(() => [
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: tools.gravel.name,
            enabled: () => "gravel" in toolNodes.value
        }))
    ]);
    const computedMaterialGainModifier = computed(() => materialGainModifier.apply(1));

    const materialLevelEffectModifier = createSequentialModifier(() => [
        createAdditiveModifier(() => ({
            addend: 0.001,
            description: tools.copper.name,
            enabled: () => "copper" in toolNodes.value
        }))
    ]);
    const computedmaterialLevelEffectModifier = computed(() =>
        materialLevelEffectModifier.apply(1.01)
    );

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
            visible: () => "dirt" in toolNodes.value
        },
        {
            title: "Ore Dropped",
            modifier: materialGainModifier,
            base: 1,
            visible: () => "gravel" in toolNodes.value
        },
        {
            title: "Material Level Effect",
            modifier: materialLevelEffectModifier,
            base: 1.01,
            visible: () => "copper" in toolNodes.value
        }
    ]);
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
            display: "Mining",
            glowColor(): string {
                return modifierTabs.activeTab.value === this.tab ? "white" : "";
            },
            visibility: () => Object.keys(toolNodes.value).length > 0,
            tab: miningTab,
            miningTabCollapsed
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

        if (board.selectedNode.value?.type === "mine") {
            const mine = board.selectedNode.value;
            const progress = Decimal.add(
                mine.state as DecimalSource,
                Decimal.times(computedMiningSpeedModifier.value, diff)
            );
            const completions = progress.floor();
            mine.state = Decimal.sub(progress, completions);
            const allResourceCompletions = completions.div(sumMineWeights).floor();
            if (allResourceCompletions.gt(0)) {
                resourceNames.forEach(resource => {
                    grantResource(
                        resource as Resources,
                        Decimal.times(
                            mineLootTable[resource as Resources] as number,
                            allResourceCompletions
                        ).times(computedMaterialGainModifier.value)
                    );
                    resourceMinedCooldown[resource as Resources] = 0.3;
                });
            }
            const remainder = Decimal.sub(completions, allResourceCompletions).toNumber();
            for (let i = 0; i < remainder; i++) {
                const random = Math.floor(Math.random() * sumMineWeights);
                let weight = 0;
                for (let i = 0; i < resourceNames.length; i++) {
                    const resource = resourceNames[i];
                    weight += mineLootTable[resource];
                    if (random <= weight) {
                        grantResource(resource, computedMaterialGainModifier.value);
                        resourceMinedCooldown[resource] = 0.3;
                        break;
                    }
                }
            }
        }

        energy.value = Decimal.add(energy.value, Decimal.times(computedEnergyModifier.value, diff));
    });

    const energyChange = computed(() => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (board.selectedAction.value === board.types.brokenFactory.actions![0]) {
            return -100;
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (board.selectedAction.value === board.types.factory.actions![0]) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return Decimal.neg(tools[board.selectedNode.value!.state as Resources].cost);
        }
        return 0;
    });
    const energyPreview = createFormulaPreview(
        Formula.variable(0).add(energy),
        () => Decimal.neq(energyChange.value, 0),
        energyChange
    );

    const energyProductionChange = computed(() => 0);
    const energyProductionPreview = createFormulaPreview(
        Formula.variable(0).add(computedEnergyModifier),
        () => Decimal.neq(energyProductionChange.value, 0),
        energyProductionChange
    );

    return {
        name: "World",
        board,
        energy,
        modifierTabs,
        hasForged,
        mineLootTable,
        tools,
        passives,
        resourceNodes,
        toolNodes,
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
): Array<GenericLayer> => [main];

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
