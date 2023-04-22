import {
    BoardNode,
    ProgressDisplay,
    Shape,
    createBoard,
    getUniqueNodeID
} from "features/boards/board";
import { jsx } from "features/feature";
import MainDisplay from "features/resources/MainDisplay.vue";
import { createResource } from "features/resources/resource";
import Formula, { calculateCost } from "game/formulas/formulas";
import type { BaseLayer, GenericLayer } from "game/layers";
import { createLayer } from "game/layers";
import { State } from "game/persistence";
import type { Player } from "game/player";
import player from "game/player";
import Decimal, { DecimalSource } from "lib/break_eternity";
import { format, formatTime } from "util/bignum";
import { render } from "util/vue";
import { ComputedRef, computed, reactive } from "vue";

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

/**
 * @hidden
 */
export const main = createLayer("main", function (this: BaseLayer) {
    const energy = createResource<DecimalSource>(0, "energy");

    const resourceLevelFormula = Formula.variable(0).add(1);
    function getResourceLevel(amount: DecimalSource) {
        const currentLevel = Decimal.floor(
            resourceLevelFormula.invertIntegral(
                Decimal.add(amount, resourceLevelFormula.evaluateIntegral())
            )
        );
        // TODO sum last x purchases?
        const requiredForCurrentLevel = calculateCost(resourceLevelFormula, currentLevel, true);
        const requiredForNextLevel = calculateCost(
            resourceLevelFormula,
            Decimal.add(currentLevel, 1),
            true
        );
        return Decimal.sub(amount, requiredForCurrentLevel)
            .div(Decimal.sub(requiredForNextLevel, requiredForCurrentLevel))
            .toNumber();
    }

    const resourceMinedCooldown: Partial<Record<Resources, number>> = reactive({});

    const board = createBoard(board => ({
        startNodes: () => [{ position: { x: 0, y: 0 }, type: "mine", state: 0 }],
        types: {
            mine: {
                shape: Shape.Diamond,
                size: 50,
                title: "Mine",
                label: node => (node === board.selectedNode.value ? null : { text: "Click me!" }),
                progress: node =>
                    node == board.selectedNode.value
                        ? new Decimal(node.state as DecimalSource).toNumber()
                        : 0,
                progressDisplay: ProgressDisplay.Outline,
                progressColor: "var(--accent2)"
            },
            resource: {
                shape: Shape.Circle,
                size: 50,
                title: node => (node.state as unknown as ResourceState).type,
                progress: node => getResourceLevel((node.state as unknown as ResourceState).amount),
                progressDisplay: ProgressDisplay.Outline,
                progressColor: "var(--accent3)",
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
            return Object.keys(resourceMinedCooldown).map(resource => ({
                startNode: mine,
                endNode: resourceNodes.value[resource as Resources],
                stroke: "var(--accent3)",
                strokeWidth: 5
            }));
        }
    }));

    const resourceNodes: ComputedRef<Record<Resources, BoardNode>> = computed(() =>
        board.nodes.value.reduce((acc, curr) => {
            if (curr.type === "resource") {
                acc[(curr.state as unknown as ResourceState).type] = curr;
            }
            return acc;
        }, {} as Record<Resources, BoardNode>)
    );

    function grantResource(type: Resources, amount: DecimalSource) {
        let node = resourceNodes.value[type];
        if (node == null) {
            let x = 0;
            x = board.nodes.value
                .filter(n => n.position.y < 50 && n.position.y > -50)
                .reduce((x, node) => Math.max(x, node.position.x + 100), 0);
            node = {
                id: getUniqueNodeID(board),
                position: { x, y: 0 },
                type: "resource",
                state: { type, amount }
            };
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
            const progress = Decimal.add(mine.state as DecimalSource, diff);
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
                        )
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
                        grantResource(resource, 1);
                        resourceMinedCooldown[resource] = 0.3;
                        break;
                    }
                }
            }
        }

        // TODO increment energy based on its modifier
    });

    return {
        name: "World",
        board,
        energy,
        display: jsx(() => (
            <>
                {player.devSpeed === 0 ? <div>Game Paused</div> : null}
                {player.devSpeed != null && player.devSpeed !== 0 && player.devSpeed !== 1 ? (
                    <div>Dev Speed: {format(player.devSpeed)}x</div>
                ) : null}
                {player.offlineTime != null && player.offlineTime !== 0 ? (
                    <div>Offline Time: {formatTime(player.offlineTime)}</div>
                ) : null}
                <MainDisplay resource={energy} />
                {render(board)}
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
