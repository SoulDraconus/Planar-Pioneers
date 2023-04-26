import { jsx } from "features/feature";
import MainDisplayVue from "features/resources/MainDisplay.vue";
import { createResource } from "features/resources/resource";
import { BaseLayer, createLayer } from "game/layers";
import { persistent } from "game/persistence";
import { DecimalSource } from "util/bignum";
import { Resources } from "./projEntry";
import { getColor, getName, sfc32 } from "./utils";

export function createPlane(id: string, tier: Resources, seed: number) {
    return createLayer(id, function (this: BaseLayer) {
        const random = sfc32(0, seed >> 0, seed >> 32, 1);
        for (let i = 0; i < 12; i++) random();

        const name = getName(random);
        const color = getColor([0.64, 0.75, 0.55], random);
        const background = getColor([0.18, 0.2, 0.25], random);
        const resource = createResource<DecimalSource>(0, getName(random));

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
            display: jsx(() => (
                <>
                    <h1>{name}</h1>
                    <MainDisplayVue resource={resource} color={color} />
                </>
            ))
        };
    });
}

export type GenericPlane = ReturnType<typeof createPlane>;
