import Modal from "components/Modal.vue";
import { JSXFunction, jsx } from "features/feature";
import { persistent } from "game/persistence";

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
