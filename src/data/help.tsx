import Modal from "components/Modal.vue";
import { JSXFunction, jsx } from "features/feature";
import { createTab } from "features/tabs/tab";
import { createTabFamily } from "features/tabs/tabFamily";
import { Persistent, persistent } from "game/persistence";
import { renderJSX } from "util/vue";
import { main } from "./projEntry";

export interface ModalData {
    modal: JSXFunction;
    showModal: Persistent<boolean>;
}

function createModal(title: string, body: JSXFunction, otherData = {}) {
    const showModal = persistent<boolean>(false);
    const modal = jsx(() => (
        <Modal
            modelValue={showModal.value}
            onUpdate:modelValue={(value: boolean) => (showModal.value = value)}
            v-slots={{
                header: () => <h2>{title}</h2>,
                body
            }}
        />
    ));
    return { modal, showModal, ...otherData };
}

export function getMineHelp() {
    return createModal(
        "Getting Started",
        jsx(() => (
            <div>
                <p>
                    Welcome to Planar Pioneers! Your job is to gather resources and eventually
                    explore and conquer increasingly difficult "planes", which are like alien
                    worlds. To start you'll use the mine (⛏️) machine to gather resources.
                </p>
                <br />
                <p>
                    You'll gain energy every second based on how much of each resource you have. You
                    can check the exact calculation and various other information by clicking the
                    "modifiers" button near the top of the screen.
                </p>
                <br />
                <p>
                    Select the machine by clicking it to make the mine active. You can also drag
                    them around to organize your various machines and other objects. While selected
                    machines will have various actions you can take, such as viewing the help for
                    that machine. There's also an action to power the machine, allowing it to be
                    active even while not selected, at the cost of energy per second (cost increases
                    based on the total number of machines being powered).
                </p>
            </div>
        ))
    );
}

export function getForgeHelp() {
    return createModal(
        "Forging",
        jsx(() => (
            <div>
                <p>
                    You've repaired the forge (🛠️)! This is the next main line of progression. Here
                    you'll be able to craft a total of 16 machines and passive bonuses to create -
                    one for each resource!
                </p>
                <br />
                <p>
                    Drag a resource onto the forge to select that resource tier. You can then use an
                    action on the forge to create that item, at the cost of energy based on the
                    resource tier. You can only have 1 of each item.
                </p>
            </div>
        ))
    );
}

export function getDowsingHelp() {
    return createModal(
        "Dowsing",
        jsx(() => (
            <div>
                <p>
                    You've created the dowsing rod (🥢)! This machine lets you bias the odds of
                    specified resources from mining. It will double the odds of each specified
                    resource, so keep in mind rare resources will still be fairly rare.
                </p>
                <br />
                <p>
                    Specify resources to boost by dragging them to the dowsing rod. You can only
                    select a single resource to start, but that can be increased using an action.
                </p>
            </div>
        ))
    );
}

export function getQuarryHelp() {
    return createModal(
        "Quarry",
        jsx(() => (
            <div>
                <p>
                    You've created the Quarry (⛰️)! This machine lets you gather specified
                    resources. Unlike the mine, this machine will always output the same resources.
                    However, rarer resources will take longer to gather.
                </p>
                <br />
                <p>
                    Specify resources to gather by dragging them to the quarry. You can only select
                    a single resource to start, but that can be increased using an action.
                </p>
            </div>
        ))
    );
}

export function getEmpowererHelp() {
    return createModal(
        "Tool Empowerer",
        jsx(() => (
            <div>
                <p>
                    You've created the Tool Empowerer (🔌)! This machine lets you increase the
                    effect of specified passives. Experimenting with which passives to empower can
                    really help you progress!
                </p>
                <br />
                <p>
                    Specify passives to empower by dragging them to the empowerer. You can only
                    select a single passive to start, but that can be increased using an action.
                </p>
            </div>
        ))
    );
}

export function getPortalHelp() {
    const tabFamily = createTabFamily({
        general: () => ({
            display: "General",
            glowColor(): string {
                return tabFamily.activeTab.value === this.tab ? "white" : "";
            },
            tab: createTab(() => ({
                display: jsx(() => (
                    <div>
                        <p>
                            You've created the Portal Generator (⛩️)! This machine lets you create
                            portals to other planes, which will have treasures that help you in
                            various ways! To create a portal you need to specify a tier by dragging
                            a resource to the generator - higher tier planes cost more energy to
                            generate portals for, but offer more and better treasures! Keep in mind
                            time in planes will be paused if the portal is inactive (not selected
                            nor powered).
                        </p>
                        <br />
                        <p>
                            You've also gained a trash can for portals (🗑️). Dragging a portal here
                            will permanently destroy it. Any treasures that require the portal to be
                            active will no longer work. This can be used to keep your workspace
                            clean from old portals you no longer need or want.
                        </p>
                    </div>
                ))
            }))
        }),
        treasures: () => ({
            display: "Treasures",
            glowColor(): string {
                return tabFamily.activeTab.value === this.tab ? "white" : "";
            },
            tab: createTab(() => ({
                display: jsx(() => (
                    <div>
                        Types of potential treasures:
                        <ul style="list-style-type: unset">
                            <li style="margin-top: var(--feature-margin)">
                                <b style="color: var(--bought)">Caches</b>: Gain an amount of a
                                resource based on your current amount.
                            </li>
                            <li style="margin-top: var(--feature-margin)">
                                <b style="color: var(--bought)">Gen</b>: Passively gain an amount of
                                a resource while the portal is active (selected or powered).
                            </li>
                            <li style="margin-top: var(--feature-margin)">
                                <b style="color: var(--bought)">Resource Mult</b>: Increase the
                                amount gained of a resource from all sources (except caches) while
                                the portal is active (selected or powered).
                            </li>
                            <li style="margin-top: var(--feature-margin)">
                                <b style="color: var(--bought)">Energy Mult</b>: Increase the energy
                                gained per second while the portal is active (selected or powered).
                            </li>
                            <li style="margin-top: var(--feature-margin)">
                                <b style="color: var(--bought)">Influences</b>: Gain a influence.
                                See the influences tab for details. You can only have 1 of each
                                influence.
                            </li>
                            <li style="margin-top: var(--feature-margin)">
                                <b style="color: var(--bought)">Relic</b>: Gain the relic unique to
                                this tier of plane. These are powerful passive boosts that can be
                                empowered. You can only have 1 of each relic. Relics can only appear
                                with the +relic influence, and will always be the last treasure on a
                                plane.
                            </li>
                        </ul>
                    </div>
                ))
            }))
        }),
        influences: () => ({
            display: "Influences",
            glowColor(): string {
                return tabFamily.activeTab.value === this.tab ? "white" : "";
            },
            tab: createTab(() => ({
                display: jsx(() => (
                    <div>
                        <p>
                            Some treasures will grant you influences that can help the portal
                            generator create portals to planes with specified qualities. Each
                            influence will multiply the energy cost of creating the portal.
                        </p>
                        <br />
                        {Object.keys(main.influenceNodes.value).length > 0 ? (
                            <div>
                                Discovered influences:
                                <ul style="list-style-type: unset">
                                    {main.influenceNodes.value.increaseResources == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+resource</b>: Can be
                                            connected to resources and will cause any treasures that
                                            reference resources (caches, gens, and resource mults)
                                            to have increased odds of picking a selected resource.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.decreaseResources == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">-resource</b>: Can be
                                            connected to resources and will cause any treasures that
                                            reference resources (caches, gens, and resource mults)
                                            to have decreased odds of picking a selected resource.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseLength == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+length</b>: Cause the
                                            plane to have 1 extra treasure than it otherwise would
                                            have.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseCaches == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+caches</b>: Causes
                                            treasures to have an increased chance to be caches.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseGens == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+gens</b>: Causes
                                            treasures to have an increased chance to be gens.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseResourceMults ==
                                    null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+resource mults</b>:
                                            Causes treasures to have an increased chance to be
                                            resource mults.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseEnergyMults ==
                                    null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+energy mults</b>:
                                            Causes treasures to have an increased chance to be
                                            energy mults.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseInfluences == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+influences</b>: Causes
                                            treasures to have an increased chance to be influences.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.relic == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+relic</b>: Maximizes
                                            length and difficulty for this tier of plane, and makes
                                            the last treasure a relic (unique per tier of plane).
                                            Overrides any other difficulty-changing influences.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseDiff == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+difficulty</b>: Causes
                                            the difficulty and rewards to be in the upper half of
                                            what's possible at this tier.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.decreaseDiff == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">-difficulty</b>: Causes
                                            the difficulty and rewards to be in the lower half of
                                            what's possible at this tier.
                                        </li>
                                    )}
                                    {main.influenceNodes.value.increaseRewards == null ? null : (
                                        <li style="margin-top: var(--feature-margin)">
                                            <b style="color: var(--bought)">+rewards</b>: Causes the
                                            quality of treasures to be 1 tier higher. Does not
                                            affect influences or relics treasures.
                                        </li>
                                    )}
                                </ul>
                            </div>
                        ) : (
                            <div>
                                Once you discover influences, summaries will appear here describing
                                their effects.
                            </div>
                        )}
                    </div>
                ))
            }))
        })
    });
    return createModal(
        "Portal Generator",
        jsx(() => renderJSX(tabFamily)),
        { tabFamily }
    );
}

export function getBoosterHelp() {
    return createModal(
        "Booster",
        jsx(() => (
            <div>
                <p>
                    You've created the Booster (⌛)! This machine lets you increase the rate of time
                    of planes! This affects its resource gain, gen treasures, and any other effects
                    of time.
                </p>
                <br />
                <p>
                    Specify planes to boost by dragging their portals to the booster. You can only
                    select a single plane to start, but that can be increased using an action.
                </p>
                <br />
                <p>
                    Initially the booster will double the rate of time, but that can be increased
                    using an action.
                </p>
            </div>
        ))
    );
}

export function getUpgraderHelp() {
    return createModal(
        "Upgrader",
        jsx(() => (
            <div>
                <p>
                    You've created the Upgrader (🤖)! This machine lets you automatically purchase
                    upgrades within planes (includes prestiges but not repeatables or dimensions)!
                </p>
                <br />
                <p>
                    Specify planes to auto-purchase upgrades from by dragging their portals to the
                    booster. You can only select a single plane to start, but that can be increased
                    using an action.
                </p>
            </div>
        ))
    );
}

export function getAutomatorHelp() {
    return createModal(
        "Automator",
        jsx(() => (
            <div>
                <p>
                    You've created the Automator (🦾)! This machine lets you automatically purchase
                    repeatables and dimensions within planes!
                </p>
                <br />
                <p>
                    Specify planes to auto-purchase repeatables and dimensions from by dragging
                    their portals to the booster. You can only select a single plane to start, but
                    that can be increased using an action.
                </p>
            </div>
        ))
    );
}

export function getInvestmentsHelp() {
    return createModal(
        "Investments",
        jsx(() => (
            <div>
                <p>
                    You've created the Investments machine (💱)! This machine lets you automatically
                    gain the resources from conversions without spending the plane's primary
                    resource!
                </p>
                <br />
                <p>
                    Specify planes to gain converted resources from by dragging their portals to the
                    booster. You can only select a single plane to start, but that can be increased
                    using an action.
                </p>
            </div>
        ))
    );
}
