import Modal from "components/Modal.vue";
import { JSXFunction, jsx } from "features/feature";
import { Persistent, persistent } from "game/persistence";

export interface ModalData {
    modal: JSXFunction;
    showModal: Persistent<boolean>;
}

function createModal(title: string, body: JSXFunction) {
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
    return { modal, showModal };
}

export function getMineHelp() {
    return createModal(
        "Getting Started",
        jsx(() => (
            <div>
                <p>
                    Welcome to Planar Pioneers! Your job is to gather resources and eventually
                    explore and conquer increasingly difficult "planes", which are like alien
                    worlds. To start you'll use the mine (🪨) machine to gather resources.
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
                    You've created the dowsing rod (🥢)! This machine let's you bias the odds of
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
