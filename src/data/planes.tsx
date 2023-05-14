import ModalVue from "components/Modal.vue";
import SpacerVue from "components/layout/Spacer.vue";
import StickyVue from "components/layout/Sticky.vue";
import { GenericAchievement, createAchievement } from "features/achievements/achievement";
import { createBar } from "features/bars/bar";
import { BoardNode, getUniqueNodeID } from "features/boards/board";
import { GenericClickable, createClickable, setupAutoClick } from "features/clickables/clickable";
import { createCumulativeConversion, setupPassiveGeneration } from "features/conversion";
import {
    BonusAmountFeatureOptions,
    GenericBonusAmountFeature,
    bonusAmountDecorator
} from "features/decorators/bonusDecorator";
import { CoercableComponent, findFeatures, isVisible, jsx } from "features/feature";
import {
    GenericRepeatable,
    RepeatableOptions,
    RepeatableType,
    createRepeatable
} from "features/repeatable";
import { createReset } from "features/reset";
import { Resource, createResource, displayResource } from "features/resources/resource";
import TooltipVue from "features/tooltips/Tooltip.vue";
import { addTooltip } from "features/tooltips/tooltip";
import {
    GenericUpgrade,
    UpgradeType,
    createUpgrade,
    setupAutoPurchase
} from "features/upgrades/upgrade";
import Formula, {
    calculateCost,
    calculateMaxAffordable,
    unrefFormulaSource
} from "game/formulas/formulas";
import { FormulaSource, InvertibleFormula, InvertibleIntegralFormula } from "game/formulas/types";
import { BaseLayer, GenericLayer, createLayer } from "game/layers";
import {
    Modifier,
    createAdditiveModifier,
    createExponentialModifier,
    createMultiplicativeModifier,
    createSequentialModifier
} from "game/modifiers";
import { State, noPersist, persistent } from "game/persistence";
import { createCostRequirement } from "game/requirements";
import Decimal, { DecimalSource, format, formatWhole } from "util/bignum";
import { Direction, WithRequired, camelToTitle } from "util/common";
import { Computable, ProcessedComputable, convertComputable } from "util/computed";
import { VueFeature, render, renderCol, renderRow, trackHover } from "util/vue";
import { ComputedRef, Ref, computed, ref, unref } from "vue";
import { useToast } from "vue-toastification";
import { isEmpowered, isPowered } from "./boardUtils";
import { createCollapsibleModifierSections, createFormulaPreview, estimateTime } from "./common";
import {
    AutomatorState,
    BoosterState,
    InfluenceState,
    Influences,
    InvestmentsState,
    PortalState,
    ResourceState,
    Resources,
    UpgraderState,
    influences as influenceTypes,
    mineLootTable,
    relics,
    resourceNames,
    tools
} from "./data";
import { hasWon, main } from "./projEntry";
import { getColor, getName, getPowerName, sfc32 } from "./utils";

const toast = useToast();

export type Treasure = GenericAchievement & {
    update?: (diff: DecimalSource) => void;
    link?: ComputedRef<BoardNode>;
    effectedResource?: Resources | "energy";
    resourceMulti: DecimalSource;
};

export type Dimension = GenericRepeatable & {
    effect: InvertibleIntegralFormula;
    dimensions: Resource;
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
        const initialBonusRewardsLevel =
            main.toolNodes.value.sandRelic != null ? (isEmpowered("sandRelic") ? 2 : 1) : 0;
        const bonusRewardsLevel = persistent<number>(initialBonusRewardsLevel);
        const rewardsLevel = computed(
            () =>
                ("increaseRewards" in influenceState ? difficulty + 1 : difficulty) +
                bonusRewardsLevel.value
        );
        let length =
            "relic" in influenceState ? tierIndex + 2 : Math.ceil(random() * (tierIndex + 2));
        if ("increaseLength" in influenceState) {
            length++;
        }

        const resourceModifiers: WithRequired<Modifier, "description" | "invert">[] = [];
        const resourceGainModifier = createSequentialModifier(() => resourceModifiers);
        const computedResourceGain = computed(() => resourceGainModifier.apply(0));

        const previews: {
            shouldShowPreview: Ref<boolean>;
            modifier?: Modifier;
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
        let previousGain: DecimalSource = 0;
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
                conversion: i <= 2 ? 0 : 12,
                xp: i <= 3 ? 0 : 8,
                dimensions: i <= 4 ? 0 : 6,
                prestige: i <= 5 || i >= length - 1 ? 0 : 4
            };
            const type = pickRandom(featureWeights, random);
            switch (type) {
                case "upgrades":
                    const upgrades: VueFeature[] = [];
                    for (let j = 0; j < 4; j++) {
                        const upgradeTypeWeights = {
                            add: 1,
                            mult: i === 0 && j === 0 ? 0 : 1
                            // pow: i === 0 ? 0 : 0.5
                        };
                        const upgradeType = pickRandom(upgradeTypeWeights, random);
                        const cost = nextCost.value;
                        const title = getPowerName(random);
                        let description = "";
                        let modifier: (
                            condition?: () => boolean
                        ) => WithRequired<Modifier, "description" | "invert">;
                        let previewModifier: WithRequired<Modifier, "invert">;
                        switch (upgradeType) {
                            case "add": {
                                const addend = Decimal.add(cost, 10).pow(random() / 4 + 1);
                                description = `Gain ${format(addend)} ${resource.displayName}/s`;
                                costFormula = costFormula.add(addend);
                                modifier = condition =>
                                    createAdditiveModifier(() => ({
                                        addend,
                                        description: title,
                                        enabled:
                                            condition == null
                                                ? upgrade.bought
                                                : () => condition() && upgrade.bought.value
                                    }));
                                previewModifier = createAdditiveModifier(() => ({ addend }));
                                break;
                            }
                            case "mult": {
                                const multiplier = random() * 5 + 1;
                                description = `Multiply previous ${
                                    resource.displayName
                                } gain by x${format(multiplier)}.`;
                                const prevGain = previousGain;
                                costFormula = costFormula.add(
                                    Decimal.sub(multiplier, 1).times(prevGain)
                                );
                                modifier = condition =>
                                    createMultiplicativeModifier(() => ({
                                        multiplier,
                                        description: title,
                                        enabled:
                                            condition == null
                                                ? upgrade.bought
                                                : () => condition() && upgrade.bought.value
                                    }));
                                previewModifier = createMultiplicativeModifier(() => ({
                                    multiplier
                                }));
                                break;
                            }
                            // case "pow": {
                            //     const exponent = random() / 10 + 1.05;
                            //     description = `Raise previous ${
                            //         resource.displayName
                            //     } gain to the ^${format(exponent)}`;
                            //     costFormula = costFormula
                            //         .add(Decimal.pow(prevGain, exponent))
                            //         .sub(prevGain);
                            //     modifier = condition =>
                            //         createExponentialModifier(() => ({
                            //             exponent,
                            //             description: title,
                            //             enabled:
                            //                 condition == null
                            //                     ? upgrade.bought
                            //                     : () => condition() && upgrade.bought.value
                            //         }));
                            //     previewModifier = createExponentialModifier(() => ({ exponent }));
                            // }
                        }
                        previousGain = costFormula.evaluate();
                        n.value++;
                        const upgradeVisibility = visibility;
                        const upgrade = createUpgrade(() => ({
                            requirements: createCostRequirement(() => ({
                                resource: noPersist(resource),
                                cost,
                                requiresPay: () => main.toolNodes.value.unobtainiumRelic == null
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
                            modifier: modifier(),
                            cost,
                            previewCost: computed(() =>
                                main.toolNodes.value.unobtainiumRelic == null ? cost : 0
                            ),
                            showETA: () => !upgrade.bought.value,
                            previewModifier
                        });
                        resourceModifiers.push(
                            modifier(() =>
                                upgradeType === "add"
                                    ? main.toolNodes.value.stoneRelic != null
                                    : isEmpowered("stoneRelic")
                            )
                        );
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
                        const title = getPowerName(random);
                        let description = "";
                        let effect: ComputedRef<string>;
                        let modifier: WithRequired<Modifier, "description" | "invert">;
                        let previewModifier: WithRequired<Modifier, "invert">;
                        let cost: InvertibleFormula;
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
                                        Decimal.sub(n.value, currentN)
                                            .times(2)
                                            .add(1)
                                            .pow(2)
                                            .clampMax(100)
                                            .times(addend)
                                    )
                                );
                                effect = computed(
                                    () =>
                                        format(
                                            Decimal.times(addend, unref(repeatable.totalAmount))
                                        ) + "/s"
                                );
                                modifier = createAdditiveModifier(() => ({
                                    addend: () =>
                                        Decimal.times(addend, unref(repeatable.totalAmount)),
                                    description: title,
                                    enabled: () => Decimal.gt(unref(repeatable.totalAmount), 0)
                                }));
                                previewModifier = createAdditiveModifier(() => ({
                                    addend: () =>
                                        Decimal.add(
                                            unref(repeatable.totalAmount),
                                            repeatable.amountToIncrease.value
                                        ).times(addend)
                                }));
                                break;
                            }
                            case "mult": {
                                const multiplier = random() * 0.75 + 1.25;
                                description = `Multiply previous ${
                                    resource.displayName
                                } gain by x${format(multiplier)}.`;
                                cost = costInput.add(1).times(initialCost);
                                const prevGain = previousGain;
                                costFormula = costFormula.add(
                                    computed(() =>
                                        Decimal.sub(n.value, currentN)
                                            .times(2)
                                            .add(1)
                                            .pow(2)
                                            .clampMax(100)
                                            .pow_base(multiplier)
                                            .sub(1)
                                            .times(prevGain)
                                    )
                                );
                                effect = computed(
                                    () =>
                                        "x" +
                                        format(
                                            Decimal.pow(multiplier, unref(repeatable.totalAmount))
                                        )
                                );
                                modifier = createMultiplicativeModifier(() => ({
                                    multiplier: () =>
                                        Decimal.pow(multiplier, unref(repeatable.totalAmount)),
                                    description: title,
                                    enabled: () => Decimal.gt(unref(repeatable.totalAmount), 0)
                                }));
                                previewModifier = createMultiplicativeModifier(() => ({
                                    multiplier: () =>
                                        Decimal.add(
                                            unref(repeatable.totalAmount),
                                            repeatable.amountToIncrease.value
                                        ).pow_base(multiplier)
                                }));
                                break;
                            }
                        }
                        previousGain = costFormula.evaluate();
                        n.value++;
                        const repeatableVisibility = visibility;
                        const repeatable = createRepeatable<
                            RepeatableOptions & BonusAmountFeatureOptions
                        >(
                            () => ({
                                requirements: createCostRequirement(() => ({
                                    resource: noPersist(resource),
                                    cost,
                                    maxBulkAmount: () =>
                                        main.toolNodes.value.diamondRelic != null
                                            ? Decimal.dInf
                                            : 1,
                                    requiresPay: () => main.toolNodes.value.unobtainiumRelic == null
                                })),
                                display: () => ({
                                    title,
                                    description: `${description}<br/><br/>Amount: ${formatWhole(
                                        repeatable.amount.value
                                    )}${
                                        Decimal.gt(unref(repeatable.bonusAmount), 0)
                                            ? ` [+${formatWhole(unref(repeatable.bonusAmount))}]`
                                            : ""
                                    }`,
                                    effectDisplay: unref(effect),
                                    showAmount: false
                                }),
                                visibility: repeatableVisibility,
                                limit: 100,
                                bonusAmount: () =>
                                    Decimal.gt(repeatable.amount.value, 0)
                                        ? isEmpowered("dirtRelic")
                                            ? 2
                                            : main.toolNodes.value.dirtRelic != null
                                            ? 1
                                            : 0
                                        : 0
                            }),
                            bonusAmountDecorator
                        ) as GenericRepeatable & GenericBonusAmountFeature;
                        prepareFeature({
                            feature: repeatable,
                            canClick: () => unref(repeatable.canClick),
                            modifier,
                            cost,
                            previewModifier,
                            previewCost: computed(() =>
                                main.toolNodes.value.unobtainiumRelic == null
                                    ? calculateCost(cost, repeatable.amountToIncrease.value)
                                    : 0
                            ),
                            showETA: () => !repeatable.maxed.value
                        });
                        repeatables.push(repeatable);
                    }
                    features.push(repeatables);
                    break;
                case "conversion": {
                    const prestigeResource = createResource(0, getName(random));
                    const prestigeColor = getColor([0.64, 0.75, 0.55], random);
                    const cost = nextCost.value;
                    const costExponent = random() / 2 + 0.25; // Random from 0.25 - 0.75
                    const effectExponent = random() / 2 + 0.25; // ditto
                    const currentN = n.value;
                    const prevGain = previousGain;
                    costFormula = costFormula.add(
                        computed(() =>
                            Decimal.sub(n.value, currentN).add(1).times(2).pow10().times(prevGain)
                        )
                    );
                    const conversion = createCumulativeConversion(() => ({
                        baseResource: noPersist(resource),
                        gainResource: prestigeResource,
                        formula: x =>
                            x
                                .div(cost)
                                .pow(costExponent)
                                .times(
                                    computed(() =>
                                        main.toolNodes.value.ironRelic != null
                                            ? isEmpowered("ironRelic")
                                                ? 4
                                                : 2
                                            : 1
                                    )
                                ),
                        spend() {
                            resource.value = 0;
                        }
                    }));
                    previousGain = costFormula.evaluate();
                    n.value += 2;
                    const clickableVisibility = visibility;
                    const title = getPowerName(random);
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
                    setupPassiveGeneration(this as GenericLayer, conversion, () =>
                        earnedTreasures.value.length < length &&
                        main.investments.value != null &&
                        isPowered(main.investments.value) &&
                        (
                            main.investments.value.state as unknown as InvestmentsState
                        ).portals.includes(id)
                            ? Decimal.div(computedPlanarSpeedModifier.value, 100)
                            : 0
                    );
                    break;
                }
                case "xp": {
                    const xp = createResource<DecimalSource>(0);
                    const barVisibility = visibility;
                    const currentN = n.value;
                    const title = getPowerName(random);
                    const cost = Decimal.add(difficulty, random() - 0.5)
                        .pow_base(1.25)
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
                    const prevGain = previousGain;
                    costFormula = costFormula.add(
                        computed(() =>
                            Decimal.sub(n.value, currentN)
                                .add(1)
                                .times(3)
                                .pow(effectExponent)
                                .times(prevGain)
                        )
                    );
                    previousGain = costFormula.evaluate();
                    n.value += 3;
                    const barColor = getColor([0.64, 0.75, 0.55], random);
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
                        fillStyle: `background-color: ${barColor}`,
                        textStyle: `text-shadow: 5px 0 10px black`
                    }));
                    this.on("preUpdate", diff => {
                        if (
                            earnedTreasures.value.length < length &&
                            main.activePortals.value.some(
                                n => (n.state as unknown as PortalState).id === id
                            ) &&
                            isVisible(bar.visibility)
                        ) {
                            let totalDiff = Decimal.times(computedPlanarSpeedModifier.value, diff);
                            if (main.toolNodes.value.goldRelic != null) {
                                totalDiff = Decimal.times(
                                    isEmpowered("goldRelic") ? 0.5 : 0.25,
                                    earnedTreasures.value.length
                                )
                                    .add(1)
                                    .times(totalDiff);
                            }
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
                case "dimensions": {
                    const title = getPowerName(random);
                    const energy = createResource<DecimalSource>(0, title + " energy");
                    const energyColor = getColor([0.64, 0.75, 0.55], random);
                    const currentN = n.value;
                    const prevGain = previousGain;
                    costFormula = costFormula.add(
                        computed(() =>
                            Decimal.sub(n.value, currentN)
                                .add(1)
                                .pow_base(32)
                                .add(1)
                                .log2()
                                .add(1)
                                .times(prevGain)
                        )
                    );
                    const effect = computed(() => Decimal.add(energy.value, 1).log2().add(1));
                    const modifier = createMultiplicativeModifier(() => ({
                        multiplier: effect,
                        description: title,
                        enabled: () => Decimal.gt(energy.value, 0)
                    }));
                    resourceModifiers.push(modifier);
                    const repeatableVisibility = visibility;
                    const clickables: Dimension[] = [];
                    for (let j = 0; j < 4; j++) {
                        const baseGain = Decimal.add(difficulty, random() - 0.5)
                            .pow_base(2)
                            .times(10)
                            .recip();
                        const initialCost = nextCost.value;
                        const clickableAmountVariable = Formula.variable(
                            computed(() => clickable.amount.value)
                        );
                        const cost = clickableAmountVariable
                            .pow_base(Decimal.pow10(j + 1))
                            .times(initialCost);
                        const dimensionTitle =
                            ["First", "Second", "Third", "Fourth"][j] + " " + title + " Dimension";
                        const dimensions = createResource<DecimalSource>(0, dimensionTitle);
                        const effect = clickableAmountVariable
                            .sub(1)
                            .pow_base(2)
                            .times(baseGain)
                            .times(
                                computed(() =>
                                    Decimal.add(clickable.amount.value, dimensions.value)
                                )
                            );
                        const clickable: Dimension = createRepeatable(() => ({
                            display: {
                                title: dimensionTitle,
                                description: jsx(() => (
                                    <div>
                                        <div>
                                            Amount:{" "}
                                            {format(
                                                Decimal.add(
                                                    dimensions.value,
                                                    clickable.amount.value
                                                )
                                            )}{" "}
                                            [{formatWhole(clickable.amount.value)}]
                                        </div>
                                    </div>
                                )),
                                effectDisplay: jsx(() => (
                                    <span>
                                        {preview()}{" "}
                                        {j === 0
                                            ? energy.displayName
                                            : ["First", "Second", "Third", "Fourth"][j - 1] +
                                              " " +
                                              title +
                                              " Dimension"}
                                        /s
                                    </span>
                                )),
                                showAmount: false
                            },
                            style: {
                                width: "400px"
                            },
                            effect,
                            dimensions,
                            limit: 100,
                            energy: j === 0 ? energy : undefined,
                            requirements: createCostRequirement(() => ({
                                resource: noPersist(resource),
                                cost,
                                maxBulkAmount: () =>
                                    isEmpowered("diamondRelic") != null ? Decimal.dInf : 1,
                                requiresPay: () => !isEmpowered("unobtainiumRelic")
                            })),
                            visibility: repeatableVisibility
                        }));
                        clickables.push(clickable);
                        const isHovering = trackHover(clickable);
                        const shouldShowPreview = computed(
                            () => unref(clickable.canClick) && isHovering.value
                        );
                        const previewFormula = new Formula({
                            inputs: [clickableAmountVariable],
                            evaluate(clickableAmount) {
                                return Decimal.sub(clickableAmount, 1)
                                    .pow_base(2)
                                    .times(baseGain)
                                    .times(Decimal.add(clickableAmount, dimensions.value));
                            }
                        });
                        const preview = createFormulaPreview(previewFormula, shouldShowPreview);
                        previews.push({
                            shouldShowPreview,
                            cost: computed(() =>
                                isEmpowered("unobtainiumRelic")
                                    ? 0
                                    : calculateCost(cost, clickable.amountToIncrease.value)
                            )
                        });
                        const eta = estimateTime(resource, computedResourceGain, () =>
                            unrefFormulaSource(cost)
                        );
                        addTooltip(clickable, {
                            display: eta,
                            direction: Direction.Down
                        });
                        previousGain = costFormula.evaluate();
                        n.value++;
                    }
                    this.on("preUpdate", diff => {
                        if (
                            earnedTreasures.value.length < length &&
                            main.activePortals.value.some(
                                n => (n.state as unknown as PortalState).id === id
                            ) &&
                            isVisible(repeatableVisibility)
                        ) {
                            let totalDiff = Decimal.times(computedPlanarSpeedModifier.value, diff);
                            if (main.toolNodes.value.platinumRelic != null) {
                                totalDiff = Decimal.times(
                                    isEmpowered("platinumRelic") ? 4 : 2,
                                    totalDiff
                                );
                            }
                            const gain = clickables[0].effect.evaluate();
                            energy.value = Decimal.times(gain, totalDiff).add(energy.value);
                            for (let i = 1; i < 4; i++) {
                                const gain = clickables[i].effect.evaluate();
                                clickables[i - 1].dimensions.value = Decimal.times(
                                    gain,
                                    totalDiff
                                ).add(clickables[i - 1].dimensions.value);
                            }
                        }
                    });
                    features.push(clickables);
                    displays[i * 2] = jsx(() => (
                        <>
                            {isVisible(repeatableVisibility) ? (
                                <div style="margin: 10px">
                                    You have{" "}
                                    <h2
                                        style={{
                                            color: energyColor,
                                            textShadow: `0px 0px 10px ${energyColor}`
                                        }}
                                    >
                                        {format(energy.value)}
                                    </h2>{" "}
                                    {energy.displayName},
                                    <br />
                                    providing a {format(effect.value)}x multiplier to previous{" "}
                                    {resource.displayName} gain
                                </div>
                            ) : null}
                            {renderCol(...clickables)}
                        </>
                    ));
                    break;
                }
                case "prestige": {
                    const title = getPowerName(random);
                    const upgradeVisibility = visibility;
                    const effectExponent = random() / 10 + 1.1; // 1.1 - 1.2
                    const cost = nextCost.value;
                    costFormula = costFormula.pow(effectExponent);
                    const modifier = createExponentialModifier(() => ({
                        exponent: effectExponent,
                        description: title,
                        enabled: upgrade.bought
                    }));
                    previousGain = costFormula.evaluate();
                    n.value += 20;
                    const thingsToReset = features.filter((f, i) => i % 2 === 0);
                    const reset = createReset(() => ({
                        thingsToReset,
                        onReset() {
                            resource.value = 0;
                        }
                    }));
                    const upgrade = createUpgrade(() => ({
                        display: {
                            title,
                            description: `Reset all previous ${name} content to raise all previous ${
                                resource.displayName
                            } gain to the ^${format(effectExponent)}`
                        },
                        style: {
                            width: "200px",
                            minHeight: "100px"
                        },
                        onPurchase: () => {
                            if (!isEmpowered("unobtainiumRelic")) {
                                reset.reset();
                            }
                        },
                        visibility: upgradeVisibility,
                        requirements: createCostRequirement(() => ({
                            resource: noPersist(resource),
                            cost,
                            requiresPay: false
                        }))
                    }));
                    const previewModifier = createMultiplicativeModifier(() => ({
                        multiplier: 0
                    }));
                    prepareFeature({
                        feature: upgrade,
                        canClick: () => unref(upgrade.canPurchase),
                        modifier,
                        cost,
                        previewCost: computed(() =>
                            isEmpowered("unobtainiumRelic") ? 0 : resource.value
                        ),
                        previewModifier,
                        showETA: () => !unref(upgrade.bought)
                    });
                    features.push([upgrade]);
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
                    description = `Gain ${format(
                        Decimal.div(rewardsLevel.value, 12)
                    )}x your current ${randomResource} (no modifiers).`;
                    onComplete = () =>
                        main.grantResource(
                            randomResource,
                            Decimal.times(
                                (
                                    main.resourceNodes.value[randomResource]
                                        ?.state as unknown as ResourceState | null
                                )?.amount ?? 0,
                                Decimal.div(rewardsLevel.value, 12)
                            )
                        );
                    break;
                case "generation":
                    randomResource = getRandomResource(random, influences);
                    const gain = Decimal.div(rewardsLevel.value, 40).times(
                        mineLootTable[randomResource]
                    );
                    description = `Gain ${format(gain)} ${randomResource}/s while plane is active.`;
                    update = diff => main.grantResource(randomResource, Decimal.times(diff, gain));
                    link = computed(() => main.resourceNodes.value[randomResource]);
                    break;
                case "resourceMulti":
                    effectedResource = randomResource = getRandomResource(random, influences);
                    resourceMulti = Decimal.div(rewardsLevel.value, 10).pow_base(2);
                    description = `Gain ${format(
                        resourceMulti
                    )}x ${randomResource} while plane is active.`;
                    break;
                case "energyMulti":
                    effectedResource = "energy";
                    resourceMulti = Decimal.div(rewardsLevel.value, 8).add(1);
                    description = `Gain ${format(resourceMulti)}x energy while plane is active.`;
                    break;
                case "influences":
                    const randomInfluence = (Object.keys(influenceTypes) as Influences[])[
                        Math.floor(random() * Object.keys(influenceTypes).length)
                    ];
                    influenceTreasures.push(randomInfluence);
                    description = `Gain a portal influence (${influenceTypes[randomInfluence].display})`;
                    onComplete = () => {
                        if (randomInfluence in main.influenceNodes.value) {
                            toast.warning(
                                `You already have a ${influenceTypes[randomInfluence].display} influence, skipping treasure`
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
                    description =
                        tier === "ultimatum"
                            ? "Win the game!"
                            : `Gain the ${tier}-tier planar relic (${relics[tier]})`;
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
                            toast.warning(
                                `You already have a ${relics[tier]} relic, skipping treasure`
                            );
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
            // Wrap milestone.earned so it doesn't get reset
            visibility = computed(() => milestone.earned.value);
        }

        const upgrades = findFeatures(
            features as unknown as Record<string, unknown>,
            UpgradeType
        ) as GenericUpgrade[];
        const repeatables = findFeatures(
            features as unknown as Record<string, unknown>,
            RepeatableType
        ) as (GenericRepeatable & GenericBonusAmountFeature)[];

        resourceModifiers.push(
            createMultiplicativeModifier(() => ({
                multiplier: () => (isEmpowered("silver") ? 4 : 2),
                description: () => (isEmpowered("silver") ? "Empowered " : "") + tools.silver.name,
                enabled: () => main.toolNodes.value.silver != null
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.add(
                        1,
                        ((isEmpowered("diamond") ? 2 : 1) *
                            upgrades.filter(u => u.bought.value).length) /
                            10
                    ),
                description: () =>
                    (isEmpowered("diamond") ? "Empowered " : "") + tools.diamond.name,
                enabled: () => main.toolNodes.value.diamond != null
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.div(timeActive.value, 6000)
                        .times(isEmpowered("emerald") ? 2 : 1)
                        .add(1),
                description: () =>
                    (isEmpowered("emerald") ? "Empowered " : "") + tools.emerald.name,
                enabled: () => main.toolNodes.value.emerald != null
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.div(
                        repeatables.reduce(
                            (acc, curr) => acc.add(unref(curr.totalAmount)),
                            Decimal.dZero
                        ),
                        100
                    )
                        .times(isEmpowered("gravelRelic") ? 2 : 1)
                        .add(1)
                        .pow(0.75),
                description: () => (isEmpowered("gravelRelic") ? "Empowered " : "") + relics.gravel,
                enabled: () => main.toolNodes.value.gravelRelic != null
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.add(main.energy.value, 1)
                        .log10()
                        .add(1)
                        .pow(isEmpowered("beryliumRelic") ? 0.5 : 0.25),
                description: () =>
                    (isEmpowered("beryliumRelic") ? "Empowered " : "") + relics.berylium,
                enabled: () => main.toolNodes.value.beryliumRelic != null
            }))
        );

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
            })),
            createMultiplicativeModifier(() => ({
                multiplier: () =>
                    Decimal.times(
                        isEmpowered("coalRelic") ? 0.2 : 0.1,
                        earnedTreasures.value.length
                    ).add(1),
                description: () => (isEmpowered("coalRelic") ? "Empowered " : "") + relics.coal,
                enabled: () => main.toolNodes.value.coalRelic != null
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
            if (earnedTreasures.value.length < length) {
                resource.value = Decimal.times(computedResourceGain.value, totalDiff).add(
                    resource.value
                );
            }

            earnedTreasures.value.forEach(treasure => {
                treasure.update?.(totalDiff);
            });
        });

        setupAutoPurchase(
            this as GenericLayer,
            () =>
                earnedTreasures.value.length < length &&
                main.upgrader.value != null &&
                isPowered(main.upgrader.value) &&
                (main.upgrader.value.state as unknown as UpgraderState).portals.includes(id),
            upgrades
        );

        setupAutoClick(
            this as GenericLayer,
            () =>
                earnedTreasures.value.length < length &&
                main.automator.value != null &&
                isPowered(main.automator.value) &&
                (main.automator.value.state as unknown as AutomatorState).portals.includes(id),
            repeatables as unknown as GenericClickable[]
        );

        const resourceChange = computed(() => {
            const preview = previews.find(p => p.shouldShowPreview.value);
            if (preview) {
                return Decimal.neg(unrefFormulaSource(preview.cost));
            }
            return 0;
        });
        const resourceProductionChange = computed(() => {
            const preview = previews.find(p => p.shouldShowPreview.value);
            if (preview && preview.modifier) {
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

        const renderableFeatures = computed(() => {
            const lastIndex = features.findIndex(
                (row, i) => i > 0 && i % 2 === 0 && !(features[i - 1][0] as Treasure).earned.value
            );
            let featuresToRender;
            if (lastIndex === -1) {
                featuresToRender = features;
            } else {
                featuresToRender = features.slice(0, lastIndex);
            }
            return featuresToRender.map((row, i) =>
                i in displays ? render(displays[i]) : renderRow(...row)
            );
        });

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
            bonusRewardsLevel,
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
                        {Decimal.neq(computedPlanarSpeedModifier.value, 1) ? (
                            <span class="nav-segment">
                                Speed: {format(computedPlanarSpeedModifier.value)}x
                            </span>
                        ) : null}
                    </StickyVue>
                    <SpacerVue height="60px" />
                    {renderableFeatures.value}
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

export type GenericPlane = ReturnType<typeof createPlane>;
