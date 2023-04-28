import SpacerVue from "components/layout/Spacer.vue";
import StickyVue from "components/layout/Sticky.vue";
import { jsx } from "features/feature";
import { createResource } from "features/resources/resource";
import { createUpgrade } from "features/upgrades/upgrade";
import Formula from "game/formulas/formulas";
import { BaseLayer, createLayer } from "game/layers";
import {
    Modifier,
    createAdditiveModifier,
    createMultiplicativeModifier,
    createSequentialModifier
} from "game/modifiers";
import { noPersist, persistent } from "game/persistence";
import { createCostRequirement } from "game/requirements";
import { adjectives, colors, uniqueNamesGenerator } from "unique-names-generator";
import Decimal, { DecimalSource } from "util/bignum";
import { format } from "util/break_eternity";
import { Direction, WithRequired, camelToTitle } from "util/common";
import { VueFeature, render, renderRow } from "util/vue";
import { computed, ref } from "vue";
import { createCollapsibleModifierSections, createFormulaPreview, estimateTime } from "./common";
import { Resources, resourceNames } from "./projEntry";
import { getColor, getName, sfc32 } from "./utils";
import ModalVue from "components/Modal.vue";
import { addTooltip } from "features/tooltips/tooltip";
import { GenericAchievement, createAchievement } from "features/achievements/achievement";
import { Computable } from "util/computed";

export function createPlane(id: string, tier: Resources, seed: number) {
    return createLayer(id, function (this: BaseLayer) {
        const random = sfc32(0, seed >> 0, seed >> 32, 1);
        for (let i = 0; i < 12; i++) random();

        const name = getName(random);
        const color = getColor([0.64, 0.75, 0.55], random);
        const background = getColor([0.18, 0.2, 0.25], random);
        const resource = createResource<DecimalSource>(0, getName(random));
        const tierIndex = resourceNames.indexOf(tier);
        const difficulty = random() + tierIndex + 1;
        const length = Math.ceil(random() * (tierIndex + 2));

        const resourceModifiers: WithRequired<Modifier, "description" | "invert">[] = [];
        const resourceGainModifier = createSequentialModifier(() => resourceModifiers);
        const computedResourceGain = computed(() => resourceGainModifier.apply(0));

        const features: VueFeature[][] = [];
        const t = ref<DecimalSource>(0);
        let costFormula = Formula.variable(t);
        let visibility: Computable<boolean> = true;
        for (let i = 0; i < length; i++) {
            const featureWeights = {
                upgrades: 16
            };
            const sumFeatureWeights = Object.values(featureWeights).reduce((a, b) => a + b);
            const featureWeightsKeys = Object.keys(
                featureWeights
            ) as (keyof typeof featureWeights)[];
            let r = Math.floor(random() * sumFeatureWeights);
            let weight = 0;
            let type: keyof typeof featureWeights | null = null;
            for (let i = 0; i < featureWeightsKeys.length; i++) {
                const feature = featureWeightsKeys[i];
                weight += featureWeights[feature];
                if (r < weight) {
                    type = feature;
                    break;
                }
            }
            if (type == null) {
                continue; // Should not happen
            }
            switch (type) {
                case "upgrades":
                    const upgrades: VueFeature[] = [];
                    for (let j = 0; j < 4; j++) {
                        const upgradeTypeWeights = {
                            add: 1,
                            mult: i === 0 && j === 0 ? 0 : 1
                        };
                        const sumUpgradeTypeWeights = Object.values(upgradeTypeWeights).reduce(
                            (a, b) => a + b
                        );
                        const upgradeTypeWeightsKeys = Object.keys(
                            upgradeTypeWeights
                        ) as (keyof typeof upgradeTypeWeights)[];
                        let weight = 0;
                        let upgradeType: keyof typeof upgradeTypeWeights | null = null;
                        r = random() * sumUpgradeTypeWeights;
                        for (let i = 0; i < upgradeTypeWeightsKeys.length; i++) {
                            const type = upgradeTypeWeightsKeys[i];
                            weight += upgradeTypeWeights[type];
                            if (r < weight) {
                                upgradeType = type;
                                break;
                            }
                        }
                        if (upgradeType == null) {
                            continue;
                        }
                        const cost = Decimal.times(difficulty, random() + 0.5)
                            .pow_base(2)
                            .times(10)
                            .times(costFormula.evaluate());
                        const title = camelToTitle(
                            uniqueNamesGenerator({
                                dictionaries: [colors, adjectives],
                                seed: random() * 4294967296,
                                separator: " "
                            }) + "ity"
                        );
                        let description = "";
                        switch (upgradeType) {
                            case "add": {
                                const addend = Decimal.add(cost, 10).pow(random() / 4 + 0.875);
                                description = `Gain ${format(addend)} ${resource.displayName}/s`;
                                costFormula = costFormula.step(t.value, c => c.add(addend));
                                resourceModifiers.push(
                                    createAdditiveModifier(() => ({
                                        addend,
                                        description: title,
                                        enabled: upgrade.bought
                                    }))
                                );
                                break;
                            }
                            case "mult": {
                                const multiplier = random() * 5 + 1;
                                description = `Multiply ${resource.displayName} gain by ${format(
                                    multiplier
                                )}.`;
                                costFormula = costFormula.step(t.value, c => {
                                    const beforeStep = Decimal.sub(t.value, c.evaluate());
                                    return c.add(beforeStep).times(multiplier).sub(beforeStep);
                                });
                                resourceModifiers.push(
                                    createMultiplicativeModifier(() => ({
                                        multiplier,
                                        description: title,
                                        enabled: upgrade.bought
                                    }))
                                );
                                break;
                            }
                        }
                        t.value = Decimal.times(difficulty, random() + 0.5)
                            .pow_base(2)
                            .add(t.value);
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
                        const eta = estimateTime(resource, computedResourceGain, cost);
                        addTooltip(upgrade, {
                            display: () => (upgrade.bought.value ? "" : eta.value),
                            direction: Direction.Down
                        });
                        upgrades.push(upgrade);
                    }
                    features.push(upgrades);
                    break;
            }
            const treasureWeights = {
                dirtGeneration: 16
            };
            const sumTreasureWeights = Object.values(treasureWeights).reduce((a, b) => a + b);
            const treasureWeightsKeys = Object.keys(
                treasureWeights
            ) as (keyof typeof treasureWeights)[];
            r = Math.floor(random() * sumTreasureWeights);
            weight = 0;
            let treasureType: keyof typeof treasureWeights | null = null;
            for (let i = 0; i < treasureWeightsKeys.length; i++) {
                const type = treasureWeightsKeys[i];
                weight += treasureWeights[type];
                if (r < weight) {
                    treasureType = type;
                    break;
                }
            }
            if (treasureType == null) {
                continue; // Should not happen
            }
            let description = "";
            switch (treasureType) {
                case "dirtGeneration":
                    description = `Gain ${format(difficulty)} dirt/s while plane is active`;
                    break;
            }
            const cost = Decimal.times(difficulty, random() + 0.5)
                .pow_base(2)
                .times(10)
                .times(costFormula.evaluate());
            const milestoneVisibility = visibility;
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
                }
            })) as GenericAchievement;
            features.push([milestone]);
            visibility = milestone.earned;
        }

        const [resourceTab, resourceTabCollapsed] = createCollapsibleModifierSections(() => [
            {
                title: `${camelToTitle(resource.displayName)} Gain`,
                modifier: resourceGainModifier,
                base: 0,
                unit: "/s"
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
            resource.value = Decimal.times(computedResourceGain.value, diff).add(resource.value);
        });

        const resourceChange = computed(() => {
            return 0;
        });
        const resourceProductionChange = computed(() => {
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

        return {
            tier: persistent(tier),
            seed: persistent(seed),
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
            display: jsx(() => (
                <>
                    <StickyVue class="nav-container">
                        <span class="nav-segment">
                            <h2>{name}</h2>
                        </span>
                        <span class="nav-segment">
                            <h3>{tier}</h3>
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
                    <SpacerVue height="50px" />
                    {features.map(row => renderRow(...row))}
                    {render(modifiersModal)}
                </>
            ))
        };
    });
}

export type GenericPlane = ReturnType<typeof createPlane>;
