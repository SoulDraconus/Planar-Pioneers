import ModalVue from "components/Modal.vue";
import SpacerVue from "components/layout/Spacer.vue";
import StickyVue from "components/layout/Sticky.vue";
import { GenericAchievement, createAchievement } from "features/achievements/achievement";
import { createBar } from "features/bars/bar";
import { BoardNode, getUniqueNodeID } from "features/boards/board";
import { createClickable } from "features/clickables/clickable";
import { createCumulativeConversion } from "features/conversion";
import { CoercableComponent, findFeatures, isVisible, jsx } from "features/feature";
import { GenericRepeatable, RepeatableType, createRepeatable } from "features/repeatable";
import { createResource, displayResource } from "features/resources/resource";
import TooltipVue from "features/tooltips/Tooltip.vue";
import { addTooltip } from "features/tooltips/tooltip";
import { GenericUpgrade, UpgradeType, createUpgrade } from "features/upgrades/upgrade";
import Formula, {
    calculateCost,
    calculateMaxAffordable,
    unrefFormulaSource
} from "game/formulas/formulas";
import { FormulaSource, GenericFormula } from "game/formulas/types";
import { BaseLayer, createLayer } from "game/layers";
import {
    Modifier,
    createAdditiveModifier,
    createExponentialModifier,
    createMultiplicativeModifier,
    createSequentialModifier
} from "game/modifiers";
import { State, noPersist, persistent } from "game/persistence";
import { createCostRequirement } from "game/requirements";
import { adjectives, colors, uniqueNamesGenerator } from "unique-names-generator";
import Decimal, { DecimalSource } from "util/bignum";
import { format, formatWhole } from "util/break_eternity";
import { Direction, WithRequired, camelToTitle } from "util/common";
import { Computable, ProcessedComputable, convertComputable } from "util/computed";
import { VueFeature, render, renderRow, trackHover } from "util/vue";
import { ComputedRef, Ref, computed, ref, unref } from "vue";
import { useToast } from "vue-toastification";
import { createCollapsibleModifierSections, createFormulaPreview, estimateTime } from "./common";
import { getColor, getName, sfc32 } from "./utils";
import {
    Resources,
    InfluenceState,
    resourceNames,
    Influences,
    PortalState,
    ResourceState,
    mineLootTable,
    relics,
    BoosterState,
    tools,
    influences as influenceTypes
} from "./data";
import { main, hasWon } from "./projEntry";

const toast = useToast();

export type Treasure = GenericAchievement & {
    update?: (diff: DecimalSource) => void;
    link?: ComputedRef<BoardNode>;
    effectedResource?: Resources | "energy";
    resourceMulti: DecimalSource;
};

export function createPlane(
    id: string,
    tier: Resources,
    seed: number,
    influences: InfluenceState[]
) {
    return createLayer(id, function (this: BaseLayer) {
        const random = sfc32(0, seed >> 0, seed >> 32, 1);
        for (let i = 0; i < 12; i++) random();

        const name = getName(random);
        const color = getColor([0.64, 0.75, 0.55], random);
        const background = getColor([0.18, 0.2, 0.25], random);
        const resource = createResource<DecimalSource>(0, getName(random));
        const timeActive = persistent<DecimalSource>(0);
        const tierIndex = resourceNames.indexOf(tier);
        let difficultyRand = random();
        const influenceState = influences.reduce((acc, curr) => {
            acc[curr.type] = curr.data;
            return acc;
        }, {} as Record<Influences, State>);
        if ("increaseDiff" in influenceState) {
            difficultyRand = difficultyRand / 2 + 0.5;
        }
        if ("decreaseDiff" in influenceState) {
            difficultyRand = difficultyRand / 2;
        }
        if ("relic" in influenceState) {
            difficultyRand = 1;
        }
        const difficulty = difficultyRand + tierIndex + 1;
        const rewardsLevel = "increaseRewards" in influenceState ? difficulty + 1 : difficulty;
        let length =
            "relic" in influenceState ? tierIndex + 2 : Math.ceil(random() * (tierIndex + 2));
        if ("increaseLength" in influenceState) {
            length++;
        }

        const resourceModifiers: WithRequired<Modifier, "description" | "invert">[] = [];
        const resourceGainModifier = createSequentialModifier(() => [
            ...resourceModifiers,
            createMultiplicativeModifier(() => ({
                multiplier: () => (main.isEmpowered("silver") ? 4 : 2),
                description: () =>
                    (main.isEmpowered("silver") ? "Empowered " : "") + tools.silver.name,
                enabled: () => main.toolNodes.value.silver != null
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    ((main.isEmpowered("diamond") ? 2 : 1) *
                        upgrades.filter(u => u.bought.value).length) /
                    10,
                description: () =>
                    (main.isEmpowered("diamond") ? "Empowered " : "") + tools.diamond.name,
                enabled: () => main.toolNodes.value.diamond != null
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.div(timeActive.value, 6000).times(main.isEmpowered("emerald") ? 2 : 1),
                description: () =>
                    (main.isEmpowered("emerald") ? "Empowered " : "") + tools.emerald.name,
                enabled: () => main.toolNodes.value.emerald != null
            }))
        ]);
        const computedResourceGain = computed(() => resourceGainModifier.apply(0));

        const previews: {
            shouldShowPreview: Ref<boolean>;
            modifier: Modifier;
            cost: FormulaSource;
        }[] = [];
        const displays: Record<number, CoercableComponent> = {};

        function prepareFeature({
            feature,
            canClick,
            modifier,
            cost,
            previewModifier,
            showETA,
            previewCost
        }: {
            feature: VueFeature;
            canClick: Computable<boolean>;
            modifier: WithRequired<Modifier, "description" | "invert">;
            cost: FormulaSource;
            previewModifier: WithRequired<Modifier, "invert">;
            showETA?: Computable<boolean | undefined>;
            previewCost?: FormulaSource;
        }) {
            canClick = convertComputable(canClick);
            showETA = convertComputable(showETA);

            const isHovering = trackHover(feature);
            previews.push({
                shouldShowPreview: computed(
                    () => unref(canClick as ProcessedComputable<boolean>) && isHovering.value
                ),
                modifier: createSequentialModifier(() => {
                    const modifiers = resourceModifiers.slice() as WithRequired<
                        Modifier,
                        "invert"
                    >[];
                    modifiers.splice(modifiers.indexOf(modifier), 1, previewModifier);
                    return modifiers;
                }),
                cost: previewCost ?? cost
            });
            resourceModifiers.push(modifier);
            const eta = estimateTime(resource, computedResourceGain, () =>
                unrefFormulaSource(cost)
            );
            const tooltip = addTooltip(feature, {
                display:
                    showETA == null
                        ? eta
                        : () => (unref(showETA as ProcessedComputable<boolean>) ? eta.value : ""),
                direction: Direction.Down
            });
            return { isHovering, eta, tooltip };
        }

        const features: VueFeature[][] = [];
        const n = ref(0);
        // Makes cost formula value reactive on n, so nextCost will update as appropriate
        let costFormula = Formula.variable(n).times(0);
        const cachedGain: Record<number, DecimalSource> = {};
        let visibility: Computable<boolean> = true;
        const nextCost = computed(() =>
            Decimal.add(difficulty, random() - 0.5)
                .pow_base(2)
                .times(10)
                .times(costFormula.evaluate())
        );
        const influenceTreasures: Influences[] = [];
        for (let i = 0; i < length; i++) {
            const featureWeights = {
                upgrades: 32,
                repeatables: i <= 1 ? 0 : 16,
                conversion: i <= 3 ? 0 : 8,
                xp: i <= 5 ? 0 : 4
                // dimensions: i <= 7 ? 0 : 2,
                // prestige: i <= 7 && i < length - 1 ? 0 : 1
            };
            const type = pickRandom(featureWeights, random);
            switch (type) {
                case "upgrades":
                    const upgrades: VueFeature[] = [];
                    for (let j = 0; j < 4; j++) {
                        const upgradeTypeWeights = {
                            add: 1,
                            mult: i === 0 && j === 0 ? 0 : 1,
                            pow: i === 0 ? 0 : 0.5
                        };
                        const upgradeType = pickRandom(upgradeTypeWeights, random);
                        const cost = nextCost.value;
                        const title = getRandomUpgrade(random);
                        let description = "";
                        let modifier: WithRequired<Modifier, "description" | "invert">;
                        let previewModifier: WithRequired<Modifier, "invert">;
                        const currentN = n.value;
                        switch (upgradeType) {
                            case "add": {
                                const addend = Decimal.add(cost, 10).pow(random() / 4 + 0.875);
                                description = `Gain ${format(addend)} ${resource.displayName}/s`;
                                costFormula = costFormula.add(addend);
                                modifier = createAdditiveModifier(() => ({
                                    addend,
                                    description: title,
                                    enabled: upgrade.bought
                                }));
                                previewModifier = createAdditiveModifier(() => ({ addend }));
                                break;
                            }
                            case "mult": {
                                const multiplier = random() * 5 + 1;
                                description = `Multiply previous ${
                                    resource.displayName
                                } gain by x${format(multiplier)}.`;
                                costFormula = costFormula.add(
                                    Decimal.sub(multiplier, 1).times(cachedGain[currentN - 1])
                                );
                                modifier = createMultiplicativeModifier(() => ({
                                    multiplier,
                                    description: title,
                                    enabled: upgrade.bought
                                }));
                                previewModifier = createMultiplicativeModifier(() => ({
                                    multiplier
                                }));
                                break;
                            }
                            case "pow": {
                                const exponent = random() / 5 + 1.1;
                                description = `Raise previous ${
                                    resource.displayName
                                } gain to the ^${format(exponent)}`;
                                costFormula = costFormula
                                    .add(Decimal.pow(cachedGain[currentN - 1], exponent))
                                    .sub(cachedGain[currentN - 1]);
                                modifier = createExponentialModifier(() => ({
                                    exponent,
                                    description: title,
                                    enabled: upgrade.bought
                                }));
                                previewModifier = createExponentialModifier(() => ({ exponent }));
                            }
                        }
                        cachedGain[n.value] = costFormula.evaluate();
                        n.value++;
                        const upgradeVisibility = visibility;
                        const upgrade = createUpgrade(() => ({
                            requirements: createCostRequirement(() => ({
                                resource: noPersist(resource),
                                cost
                            })),
                            display: {
                                title,
                                description
                            },
                            visibility: upgradeVisibility
                        }));
                        prepareFeature({
                            feature: upgrade,
                            canClick: () => upgrade.canPurchase.value,
                            modifier,
                            cost,
                            showETA: () => !upgrade.bought.value,
                            previewModifier
                        });
                        upgrades.push(upgrade);
                    }
                    features.push(upgrades);
                    break;
                case "repeatables":
                    const repeatables: VueFeature[] = [];
                    for (let j = 0; j < 3; j++) {
                        const repeatableTypeWeights = {
                            add: 1.5,
                            mult: 3
                            // pow was too hard to implement such that the cost would be invertible
                        };
                        const upgradeType = pickRandom(repeatableTypeWeights, random);
                        // Repeatables will estimate 5 purchases between each increment of `n`
                        // This will become less accurate the further n gets from when the repeatable showed up, but at that time it should be having an increasingly smaller effect on the overall gain
                        const currentN = n.value;
                        const initialCost = nextCost.value;
                        const title = getRandomUpgrade(random);
                        let description = "";
                        let effect: ComputedRef<string>;
                        let modifier: WithRequired<Modifier, "description" | "invert">;
                        let previewModifier: WithRequired<Modifier, "invert">;
                        let cost: GenericFormula;
                        const costInput = Formula.variable(
                            computed(() => repeatable.amount.value)
                        ).times(2);
                        switch (upgradeType) {
                            case "add": {
                                const addend = Decimal.add(initialCost, 10).times(random() + 0.5);
                                description = `Gain ${format(addend)} ${resource.displayName}/s`;
                                cost = costInput.add(1).times(initialCost);
                                costFormula = costFormula.add(
                                    computed(() =>
                                        Decimal.sub(n.value, currentN).add(1).times(5).times(addend)
                                    )
                                );
                                effect = computed(
                                    () =>
                                        format(Decimal.times(addend, repeatable.amount.value)) +
                                        "/s"
                                );
                                modifier = createAdditiveModifier(() => ({
                                    addend: () => Decimal.times(addend, repeatable.amount.value),
                                    description: title,
                                    enabled: () => Decimal.gt(repeatable.amount.value, 0)
                                }));
                                previewModifier = createAdditiveModifier(() => ({
                                    addend: () =>
                                        Decimal.add(repeatable.amount.value, 1).times(addend)
                                }));
                                break;
                            }
                            case "mult": {
                                const multiplier = random() * 0.75 + 1.25;
                                description = `Multiply previous ${
                                    resource.displayName
                                } gain by x${format(multiplier)}.`;
                                cost = costInput.pow_base(multiplier).times(initialCost);
                                costFormula = costFormula.add(
                                    computed(() =>
                                        Decimal.sub(n.value, currentN)
                                            .add(1)
                                            .times(5)
                                            .pow_base(multiplier)
                                            .sub(1)
                                            .times(cachedGain[currentN - 1])
                                    )
                                );
                                effect = computed(
                                    () =>
                                        "x" +
                                        format(Decimal.pow(multiplier, repeatable.amount.value))
                                );
                                modifier = createMultiplicativeModifier(() => ({
                                    multiplier: () =>
                                        Decimal.pow(multiplier, repeatable.amount.value),
                                    description: title,
                                    enabled: () => Decimal.gt(repeatable.amount.value, 0)
                                }));
                                previewModifier = createMultiplicativeModifier(() => ({
                                    multiplier: () =>
                                        Decimal.add(repeatable.amount.value, 1).pow_base(multiplier)
                                }));
                                break;
                            }
                        }
                        cachedGain[n.value] = costFormula.evaluate();
                        n.value++;
                        const repeatableVisibility = visibility;
                        const repeatable = createRepeatable(() => ({
                            requirements: createCostRequirement(() => ({
                                resource: noPersist(resource),
                                cost
                            })),
                            display: () => ({
                                title,
                                description,
                                effectDisplay: unref(effect)
                            }),
                            visibility: repeatableVisibility
                        }));
                        prepareFeature({
                            feature: repeatable,
                            canClick: () => unref(repeatable.canClick),
                            modifier,
                            cost,
                            previewModifier
                        });
                        repeatables.push(repeatable);
                    }
                    features.push(repeatables);
                    break;
                case "conversion":
                    const prestigeResource = createResource(0, getName(random));
                    const prestigeColor = getColor([0.64, 0.75, 0.55], random);
                    const cost = nextCost.value;
                    const costExponent = random() / 2 + 0.25; // Random from 0.25 - 0.75
                    const effectExponent = random() / 2 + 0.25; // ditto
                    const currentN = n.value;
                    costFormula = costFormula.add(
                        computed(() =>
                            Decimal.sub(n.value, currentN)
                                .add(1)
                                .pow_base(5)
                                .pow(effectExponent)
                                .times(cachedGain[currentN - 1])
                        )
                    );
                    const conversion = createCumulativeConversion(() => ({
                        baseResource: noPersist(resource),
                        gainResource: prestigeResource,
                        formula: x => x.div(cost).pow(costExponent),
                        spend() {
                            resource.value = 0;
                        }
                    }));
                    cachedGain[n.value] = costFormula.evaluate();
                    n.value += 2;
                    const clickableVisibility = visibility;
                    const title = getRandomUpgrade(random);
                    const formula = Formula.variable(prestigeResource).pow(effectExponent).add(1);
                    const modifier = createMultiplicativeModifier(() => ({
                        multiplier: () => formula.evaluate(),
                        description: title,
                        enabled: () => Decimal.gt(prestigeResource.value, 0)
                    }));
                    const previewModifier = createMultiplicativeModifier(() => ({
                        multiplier: () =>
                            formula.evaluate(
                                Decimal.add(prestigeResource.value, conversion.actualGain.value)
                            )
                    }));
                    const clickable = createClickable(() => ({
                        display: {
                            title,
                            description: jsx(() => (
                                <span>
                                    Reset {resource.displayName} for{" "}
                                    {displayResource(
                                        prestigeResource,
                                        Decimal.clampMin(conversion.actualGain.value, 1)
                                    )}{" "}
                                    {prestigeResource.displayName}
                                    <br />
                                    <div>
                                        Next:{" "}
                                        {displayResource(
                                            resource,
                                            Decimal.lt(conversion.actualGain.value, 1)
                                                ? conversion.currentAt.value
                                                : conversion.nextAt.value
                                        )}{" "}
                                        {resource.displayName}
                                    </div>
                                </span>
                            ))
                        },
                        style: {
                            width: "200px",
                            minHeight: "100px"
                        },
                        canClick: () => Decimal.gte(conversion.actualGain.value, 1),
                        prestigeResource,
                        onClick: conversion.convert,
                        visibility: clickableVisibility
                    }));
                    const { isHovering } = prepareFeature({
                        feature: clickable,
                        canClick: () => unref(clickable.canClick),
                        modifier,
                        cost,
                        previewCost: resource,
                        previewModifier
                    });
                    const showPreview = computed(
                        () => isHovering.value && clickable.canClick.value
                    );
                    features.push([clickable]);
                    const resourcePreview = createFormulaPreview(
                        Formula.variable(prestigeResource),
                        showPreview,
                        conversion.actualGain
                    );
                    const effectPreview = createFormulaPreview(
                        formula,
                        showPreview,
                        conversion.actualGain
                    );
                    displays[i * 2] = jsx(() => (
                        <>
                            {isVisible(clickable.visibility) ? (
                                <div style="margin: 10px">
                                    You have{" "}
                                    <h2
                                        style={{
                                            color: prestigeColor,
                                            textShadow: `0px 0px 10px ${prestigeColor}`
                                        }}
                                    >
                                        {resourcePreview()}
                                    </h2>{" "}
                                    {prestigeResource.displayName},
                                    <br />
                                    providing a {effectPreview()}x multiplier to previous{" "}
                                    {resource.displayName} gain
                                </div>
                            ) : null}
                            {renderRow(clickable)}
                        </>
                    ));
                    break;
                case "xp": {
                    const xp = createResource<DecimalSource>(0);
                    const barVisibility = visibility;
                    const currentN = n.value;
                    const title = getRandomUpgrade(random);
                    const cost = Decimal.add(difficulty, random() - 0.5)
                        .pow_base(2)
                        .times(10);
                    const levelDifficulty = random() / 4 + 1.125; // 1.125 - 1.375
                    const effectExponent = random() / 2 + 1.25; // 1.25 - 1.75
                    const xpReq = Formula.variable(0).pow(levelDifficulty).times(cost);
                    const level = calculateMaxAffordable(xpReq, xp, true, 10, Decimal.dInf);
                    const xpForCurrentLevel = computed(() =>
                        calculateCost(xpReq, level.value, true, 10)
                    );
                    const xpToNextLevel = computed(() =>
                        calculateCost(xpReq, Decimal.add(level.value, 1), true, 10)
                    );
                    const effect = computed(() => Decimal.pow(effectExponent, level.value));
                    const modifier = createMultiplicativeModifier(() => ({
                        multiplier: effect,
                        description: title,
                        enabled: () => isVisible(bar.visibility)
                    }));
                    costFormula = costFormula.add(
                        computed(() =>
                            Decimal.sub(n.value, currentN)
                                .add(1)
                                .sqrt()
                                .times(3)
                                .pow(effectExponent)
                                .times(cachedGain[currentN - 1])
                        )
                    );
                    cachedGain[n.value] = costFormula.evaluate();
                    n.value += 2;
                    const barColor = getColor([0.18, 0.2, 0.25], random);
                    const bar = createBar(() => ({
                        direction: Direction.Right,
                        width: 300,
                        height: 20,
                        progress: () =>
                            Decimal.sub(xp.value, xpForCurrentLevel.value)
                                .div(Decimal.sub(xpToNextLevel.value, xpForCurrentLevel.value))
                                .toNumber(),
                        visibility: barVisibility,
                        xp,
                        display: jsx(() => (
                            <span>
                                {format(xp.value)}/{format(xpToNextLevel.value)}
                            </span>
                        )),
                        fillStyle: `background-color: ${barColor}`
                    }));
                    this.on("preUpdate", diff => {
                        if (
                            main.activePortals.value.some(
                                n => (n.state as unknown as PortalState).id === id
                            ) &&
                            isVisible(bar.visibility)
                        ) {
                            const totalDiff = Decimal.times(
                                computedPlanarSpeedModifier.value,
                                diff
                            );
                            xp.value = Decimal.add(totalDiff, xp.value);
                        }
                    });
                    resourceModifiers.push(modifier);
                    features.push([bar]);
                    displays[i * 2] = jsx(() => (
                        <>
                            {isVisible(bar.visibility) ? (
                                <div style="margin: 10px">
                                    You have <h3>{title}</h3> Lv. {formatWhole(level.value)},<br />
                                    providing a {format(effect.value)}x multiplier to previous{" "}
                                    {resource.displayName} gain
                                    <br />
                                </div>
                            ) : null}
                            {renderRow(bar)}
                        </>
                    ));
                    break;
                }
            }
            const treasureWeights = {
                cache: "increaseCaches" in influenceState ? 10 : 1,
                generation: "increaseGens" in influenceState ? 10 : 1,
                resourceMulti: "increaseResourceMults" in influenceState ? 10 : 1,
                energyMulti: "increaseEnergyMults" in influenceState ? 2.5 : 0.25,
                influences:
                    Object.keys(main.influenceNodes.value).length + influenceTreasures.length ===
                    Object.keys(influenceTypes).length
                        ? 0
                        : "increaseInfluences" in influenceState
                        ? 20
                        : 2,
                relic: 0
            };
            let treasureType = pickRandom(treasureWeights, random);
            if (i === length - 1 && "relic" in influenceState) {
                treasureType = "relic";
            }
            let description = "";
            let update: (diff: DecimalSource) => void;
            let onComplete: VoidFunction;
            let link: ComputedRef<BoardNode>;
            let randomResource: Resources;
            let effectedResource: Resources | "energy";
            let resourceMulti: DecimalSource;
            switch (treasureType) {
                case "cache":
                    randomResource = getRandomResource(random, influences);
                    description = `Gain ${format(rewardsLevel)}x your current ${randomResource}.`;
                    onComplete = () =>
                        main.grantResource(
                            randomResource,
                            Decimal.times(
                                (
                                    main.resourceNodes.value[randomResource]
                                        ?.state as unknown as ResourceState | null
                                )?.amount ?? 0,
                                rewardsLevel
                            )
                        );
                    break;
                case "generation":
                    randomResource = getRandomResource(random, influences);
                    const gain = Decimal.div(rewardsLevel, 120).times(
                        mineLootTable[randomResource]
                    );
                    description = `Gain ${format(gain)} ${randomResource}/s while plane is active.`;
                    update = diff => main.grantResource(randomResource, Decimal.times(diff, gain));
                    link = computed(() => main.resourceNodes.value[randomResource]);
                    break;
                case "resourceMulti":
                    effectedResource = randomResource = getRandomResource(random, influences);
                    resourceMulti = Decimal.div(rewardsLevel, 17).pow_base(2);
                    description = `Gain ${format(
                        resourceMulti
                    )}x ${randomResource} while plane is active.`;
                    break;
                case "energyMulti":
                    effectedResource = "energy";
                    resourceMulti = Decimal.div(rewardsLevel, 17).add(1);
                    description = `Gain ${format(resourceMulti)}x energy while plane is active.`;
                    break;
                case "influences":
                    const randomInfluence = (Object.keys(influenceTypes) as Influences[])[
                        Math.floor(random() * Object.keys(influenceTypes).length)
                    ];
                    influenceTreasures.push(randomInfluence);
                    description = `Gain a new portal influence (${influenceTypes[randomInfluence].display})`;
                    onComplete = () => {
                        if (randomInfluence in main.influenceNodes.value) {
                            toast.warning(
                                `Error: ignoring duplicate portal influence (${influenceTypes[randomInfluence].display})`
                            );
                            return;
                        }
                        const node = {
                            id: getUniqueNodeID(main.board),
                            position: {
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                ...main.board.types.portal.nodes.value.find(
                                    n => (n.state as unknown as PortalState).id === id
                                )!.position
                            },
                            type: "influence",
                            state: {
                                type: randomInfluence,
                                data: influenceTypes[randomInfluence].initialData
                            }
                        };
                        main.board.placeInAvailableSpace(node);
                        main.board.nodes.value.push(node);
                    };
                    break;
                case "relic":
                    description = `Gain the ${tier}-tier planar relic (${relics[tier]})`;
                    onComplete = () => {
                        if (tier === "ultimatum") {
                            hasWon.value = true;
                            return;
                        }
                        if (!(`${tier}Relic` in main.toolNodes.value)) {
                            const node = {
                                id: getUniqueNodeID(main.board),
                                position: {
                                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                    ...main.board.types.portal.nodes.value.find(
                                        n => (n.state as unknown as PortalState).id === id
                                    )!.position
                                },
                                type: "passive",
                                state: `${tier}Relic`
                            };
                            main.board.placeInAvailableSpace(node);
                            main.board.nodes.value.push(node);
                        } else {
                            toast.warning(`Error: ignoring duplicate relic (${relics[tier]})`);
                        }
                    };
            }
            const milestoneVisibility = visibility;
            const cost = nextCost.value;
            const milestone = createAchievement(() => ({
                requirements: createCostRequirement(() => ({
                    resource: noPersist(resource),
                    cost
                })),
                visibility: milestoneVisibility,
                display: {
                    requirement: `${format(cost)} ${resource.displayName}`,
                    effectDisplay: description
                },
                style: "width: 100%",
                classes: {
                    final: i === length - 1
                },
                update,
                onComplete,
                link,
                effectedResource,
                resourceMulti
            })) satisfies Treasure as GenericAchievement;
            const eta = estimateTime(resource, computedResourceGain, cost);
            addTooltip(milestone, {
                display: () => (milestone.earned.value ? "" : eta.value),
                direction: Direction.Down
            });
            features.push([milestone]);
            visibility = milestone.earned;
        }

        const upgrades = findFeatures(
            features as unknown as Record<string, unknown>,
            UpgradeType
        ) as GenericUpgrade[];
        const repeatables = findFeatures(
            features as unknown as Record<string, unknown>,
            RepeatableType
        ) as GenericRepeatable[];

        const planarSpeedModifier = createSequentialModifier(() => [
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.add(
                        (
                            main.board.types.booster.nodes.value[0]?.state as unknown as
                                | BoosterState
                                | undefined
                        )?.level ?? 0,
                        1
                    ),
                description: "Booster",
                enabled: () =>
                    (
                        main.board.types.booster.nodes.value[0]?.state as unknown as
                            | BoosterState
                            | undefined
                    )?.portals.includes(id) ?? false
            }))
        ]);
        const computedPlanarSpeedModifier = computed(() => planarSpeedModifier.apply(1));

        const [resourceTab, resourceTabCollapsed] = createCollapsibleModifierSections(() => [
            {
                title: `${camelToTitle(resource.displayName)} Gain`,
                modifier: resourceGainModifier,
                base: 0,
                unit: "/s"
            },
            {
                title: `${camelToTitle(resource.displayName)} Time Speed`,
                modifier: planarSpeedModifier,
                base: 1,
                visible: () => Decimal.gt(computedPlanarSpeedModifier.value, 1)
            }
        ]);
        const showModifiersModal = ref(false);
        const modifiersModal = jsx(() => (
            <ModalVue
                modelValue={showModifiersModal.value}
                onUpdate:modelValue={(value: boolean) => (showModifiersModal.value = value)}
                v-slots={{
                    header: () => <h2>Modifiers</h2>,
                    body: () => render(resourceTab)
                }}
            />
        ));

        this.on("preUpdate", diff => {
            if (
                !main.activePortals.value.some(n => (n.state as unknown as PortalState).id === id)
            ) {
                return;
            }
            const totalDiff = Decimal.times(computedPlanarSpeedModifier.value, diff);

            timeActive.value = Decimal.add(timeActive.value, totalDiff);
            resource.value = Decimal.times(computedResourceGain.value, totalDiff).add(
                resource.value
            );

            earnedTreasures.value.forEach(treasure => {
                treasure.update?.(totalDiff);
            });
        });

        const resourceChange = computed(() => {
            const preview = previews.find(p => p.shouldShowPreview.value);
            if (preview) {
                return Decimal.neg(unrefFormulaSource(preview.cost));
            }
            return 0;
        });
        const resourceProductionChange = computed(() => {
            const preview = previews.find(p => p.shouldShowPreview.value);
            if (preview) {
                return Decimal.sub(preview.modifier.apply(0), computedResourceGain.value);
            }
            return 0;
        });
        const resourcePreview = createFormulaPreview(
            Formula.variable(0).add(resource),
            () => Decimal.neq(resourceChange.value, 0),
            resourceChange
        );
        const resourceProductionPreview = createFormulaPreview(
            Formula.variable(0).add(computedResourceGain),
            () => Decimal.neq(resourceProductionChange.value, 0),
            resourceProductionChange
        );

        const links = computed(() => {
            const links: ComputedRef<BoardNode>[] = [];
            earnedTreasures.value.forEach(treasure => {
                if (treasure.link) {
                    links.push(treasure.link);
                }
            });
            return links;
        });

        const resourceMultis = computed(() => {
            const multis: Partial<Record<Resources | "energy", DecimalSource>> = {};
            earnedTreasures.value.forEach(treasure => {
                if (treasure.effectedResource != null && treasure.resourceMulti != null) {
                    if (multis[treasure.effectedResource] != null) {
                        multis[treasure.effectedResource] = Decimal.times(
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            multis[treasure.effectedResource]!,
                            treasure.resourceMulti
                        );
                    } else {
                        multis[treasure.effectedResource] = treasure.resourceMulti;
                    }
                }
            });
            return multis;
        });

        const earnedTreasures = computed(() => {
            const earned: Treasure[] = [];
            for (let i = 1; i < features.length; i += 2) {
                const treasure = features[i][0] as Treasure;
                if (treasure.earned.value) {
                    earned.push(treasure);
                }
            }
            return earned;
        });

        const showNotif = computed(
            () =>
                Decimal.lt(earnedTreasures.value.length, length) &&
                features.some(features =>
                    features.some(feature => {
                        if (
                            "earned" in feature &&
                            unref(feature.earned as ProcessedComputable<boolean>)
                        ) {
                            return false;
                        }
                        if (
                            "bought" in feature &&
                            unref(feature.bought as ProcessedComputable<boolean>)
                        ) {
                            return false;
                        }
                        if (
                            "canClick" in feature &&
                            unref(feature.canClick as ProcessedComputable<boolean>)
                        ) {
                            return true;
                        }
                        if (
                            "canPurchase" in feature &&
                            unref(feature.canPurchase as ProcessedComputable<boolean>)
                        ) {
                            return true;
                        }
                        return true;
                    })
                )
        );

        return {
            tier: persistent(tier),
            seed: persistent(seed),
            influences: persistent(influences as unknown as State[]),
            name,
            color,
            resource,
            background,
            style: {
                background,
                "--background": background
            },
            features,
            resourceTabCollapsed,
            links,
            resourceMultis,
            earnedTreasures,
            showNotif,
            timeActive,
            display: jsx(() => (
                <>
                    <StickyVue class="nav-container" style="z-index: 5">
                        <span class="nav-segment">
                            <h2>{name}</h2>
                        </span>
                        <span class="nav-segment">
                            <h3>{tier}-tier</h3>
                        </span>
                        {influences.length === 0 ? null : (
                            <span class="nav-segment">
                                <TooltipVue
                                    display={influences
                                        .map(influence => {
                                            const description =
                                                influenceTypes[influence.type].description;
                                            if (typeof description === "function") {
                                                return description(influence);
                                            }
                                            return description;
                                        })
                                        .join("<br/>")}
                                    direction={Direction.Down}
                                    style={"width: 300px"}
                                >
                                    <h3>{influences.length} influences</h3>
                                </TooltipVue>
                            </span>
                        )}
                        <span class="nav-segment">
                            <button
                                class="button"
                                style="display: inline"
                                onClick={() => (showModifiersModal.value = true)}
                            >
                                modifiers
                            </button>
                        </span>
                    </StickyVue>
                    <StickyVue class="nav-container">
                        <span class="nav-segment">
                            <h3 style={`color: ${color}; text-shadow: 0px 0px 10px ${color};`}>
                                {render(resourcePreview)}
                            </h3>{" "}
                            {resource.displayName}
                        </span>
                        <span class="nav-segment">
                            (
                            <h3 style={`color: ${color}; text-shadow: 0px 0px 10px ${color};`}>
                                {Decimal.gt(computedResourceGain.value, 0) ? "+" : ""}
                                {render(resourceProductionPreview)}
                            </h3>
                            /s)
                        </span>
                    </StickyVue>
                    <SpacerVue height="60px" />
                    {features.map((row, i) =>
                        i in displays ? render(displays[i]) : renderRow(...row)
                    )}
                    {render(modifiersModal)}
                </>
            )),
            minimizedDisplay: jsx(() => (
                <div>
                    <span>{name}</span>
                    <span style="font-size: large; vertical-align: sub;">
                        {" "}
                        {earnedTreasures.value.length}/{length} treasures
                    </span>
                </div>
            ))
        };
    });
}

// Using separate method from what's used in mining, because planes are influenced by influences and not things like dowsing
function getRandomResource(random: () => number, influences: InfluenceState[]) {
    influences = influences.filter(
        i => i.type === "increaseResources" || i.type === "decreaseResources"
    );
    const sumResourceWeights = (Object.keys(mineLootTable) as Resources[]).reduce((a, b) => {
        let weight = mineLootTable[b];
        influences
            .filter(i => i.data === b)
            .forEach(influence => {
                if (influence.type === "increaseResources") {
                    weight *= 1000;
                } else {
                    weight /= 1000;
                }
            });
        return a + weight;
    }, 0);
    const resourceWeightsKeys = Object.keys(mineLootTable) as Resources[];
    const r = Math.floor(random() * sumResourceWeights);
    let weight = 0;
    let resource: Resources;
    for (let i = 0; i < resourceWeightsKeys.length; i++) {
        const type = resourceWeightsKeys[i];
        weight += mineLootTable[type];
        if (r < weight) {
            resource = type;
            break;
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return resource!;
}

function pickRandom<T extends string>(items: Record<T, number>, random: () => number) {
    const sumWeights = (Object.values(items) as number[]).reduce((a, b) => a + b);
    const keys = Object.keys(items) as T[];
    let weight = 0;
    let result: T | null = null;
    const r = random() * sumWeights;
    for (let i = 0; i < keys.length; i++) {
        const type = keys[i];
        weight += items[type];
        if (r < weight) {
            result = type;
            break;
        }
    }
    if (result == null) {
        throw new Error("Failed to pick random. This should not happen");
    }
    return result;
}

function getRandomUpgrade(random: () => number) {
    return camelToTitle(
        uniqueNamesGenerator({
            dictionaries: [colors, adjectives],
            seed: random() * 4294967296,
            separator: " "
        }) + "ity"
    );
}

export type GenericPlane = ReturnType<typeof createPlane>;
