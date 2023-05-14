import { BoardNode, GenericBoard, GenericBoardNodeAction, NodeLabel } from "features/boards/board";
import Formula from "game/formulas/formulas";
import { GenericFormula, InvertibleIntegralFormula } from "game/formulas/types";
import Decimal, { formatWhole } from "util/bignum";
import {
    BoosterState,
    DowsingState,
    EmpowererState,
    InfluenceState,
    Passives,
    PortalState,
    ResourceState,
    Resources
} from "./data";
import { main } from "./projEntry";
import { DecimalSource } from "lib/break_eternity";
import { ComputedRef } from "vue";

export const resourceLevelFormula = Formula.variable(0)
    .step(2000, x => x.pow_base(1.02))
    .step(100, x => x.pow(1.5))
    .step(Decimal.pow(900, 1.5).add(100), x => x.pow(1.5))
    .pow(1.5);

export const deselectAllAction = {
    id: "deselect",
    icon: "close",
    tooltip: (node: BoardNode) => ({
        text:
            "portals" in (node.state as object)
                ? "Disconnect portals"
                : "tools" in (node.state as object)
                ? "Disconnect tools"
                : "Disconnect resources"
    }),
    onClick(node: BoardNode) {
        if (Array.isArray((node.state as unknown as InfluenceState)?.data)) {
            node.state = { ...(node.state as object), data: [] };
        } else if ("portals" in (node.state as object)) {
            node.state = { ...(node.state as object), portals: [] };
        } else if ("resources" in (node.state as object)) {
            node.state = { ...(node.state as object), resources: [] };
        } else if ("tools" in (node.state as object)) {
            node.state = { ...(node.state as object), tools: [] };
        }
        main.board.selectedAction.value = null;
        main.board.selectedNode.value = null;
    },
    visibility: (node: BoardNode) => {
        if (Array.isArray((node.state as unknown as InfluenceState)?.data)) {
            return ((node.state as unknown as InfluenceState).data as string[]).length > 0;
        }
        if ("portals" in (node.state as object)) {
            return (node.state as { portals: string[] }).portals.length > 0;
        }
        if ("resources" in (node.state as object)) {
            return (node.state as { resources: Resources[] }).resources.length > 0;
        }
        if ("tools" in (node.state as object)) {
            return (node.state as { tools: Passives[] }).tools.length > 0;
        }
        return false;
    }
};

export const togglePoweredAction = {
    id: "toggle",
    icon: "bolt",
    tooltip: (node: BoardNode): NodeLabel => ({
        text: (node.state as { powered: boolean }).powered
            ? "Turn Off"
            : `Turn On - Always runs for ${formatWhole(main.nextPowerCost.value)} energy/s`
    }),
    onClick(node: BoardNode) {
        node.state = {
            ...(node.state as object),
            powered: !(node.state as { powered: boolean }).powered
        };
        main.board.selectedAction.value = null;
    },
    fillColor: (node: BoardNode) =>
        (node.state as { powered: boolean }).powered ? "var(--accent1)" : "var(--locked)"
} as GenericBoardNodeAction;

export function getIncreaseConnectionsAction(
    cost: (x: InvertibleIntegralFormula) => GenericFormula,
    maxConnections = Infinity
) {
    const formula = cost(Formula.variable(0));
    return {
        id: "moreConnections",
        icon: "hub",
        formula,
        tooltip(node: BoardNode) {
            return {
                text: `Increase Connections - ${formatWhole(
                    formula.evaluate((node.state as { maxConnections: number }).maxConnections)
                )} energy`
            };
        },
        fillColor(node: BoardNode) {
            return Decimal.gte(
                main.energy.value,
                formula.evaluate((node.state as { maxConnections: number }).maxConnections)
            )
                ? "var(--bought)"
                : "var(--locked)";
        },
        confirmationLabel: (node: BoardNode): NodeLabel =>
            Decimal.gte(
                main.energy.value,
                formula.evaluate((node.state as { maxConnections: number }).maxConnections)
            )
                ? { text: "Tap again to confirm" }
                : { text: "Cannot afford", color: "var(--danger)" },
        onClick(node: BoardNode) {
            const cost = formula.evaluate(
                (node.state as { maxConnections: number }).maxConnections
            );
            if (Decimal.gte(main.energy.value, cost)) {
                main.energy.value = Decimal.sub(main.energy.value, cost);
                node.state = {
                    ...(node.state as object),
                    maxConnections: Decimal.add(
                        (node.state as { maxConnections: number }).maxConnections,
                        1
                    )
                };
                main.board.selectedAction.value = null;
            }
        },
        visibility: (node: BoardNode): boolean =>
            Decimal.add(
                (node.state as { maxConnections: number }).maxConnections,
                main.computedBonusConnectionsModifier.value
            ).lt(maxConnections)
    };
}

export function labelForAcceptingResource(
    node: BoardNode,
    description: (resource: Resources) => string
): NodeLabel | null {
    if ((main.board as GenericBoard).draggingNode.value?.type === "resource") {
        const resource = (
            (main.board as GenericBoard).draggingNode.value?.state as unknown as ResourceState
        ).type;
        const { maxConnections, resources } = node.state as unknown as DowsingState;
        if (resources.includes(resource)) {
            return { text: "Disconnect", color: "var(--accent2)" };
        }
        if (
            Decimal.add(maxConnections, main.computedBonusConnectionsModifier.value).lte(
                resources.length
            )
        ) {
            return { text: "Max connections", color: "var(--danger)" };
        }
        return {
            text: description(resource),
            color: "var(--accent2)"
        };
    }
    return null;
}

export function labelForAcceptingTool(
    node: BoardNode,
    description: (passive: Passives) => string
): NodeLabel | null {
    if ((main.board as GenericBoard).draggingNode.value?.type === "passive") {
        const passive = (main.board as GenericBoard).draggingNode.value?.state as Passives;
        const { maxConnections, tools } = node.state as unknown as EmpowererState;
        if (tools.includes(passive)) {
            return { text: "Disconnect", color: "var(--accent2)" };
        }
        if (
            Decimal.add(maxConnections, main.computedBonusConnectionsModifier.value).lte(
                tools.length
            )
        ) {
            return { text: "Max connections", color: "var(--danger)" };
        }
        return {
            text: description(passive),
            color: "var(--accent2)"
        };
    }
    return null;
}

export function labelForAcceptingPortal(
    node: BoardNode,
    description: (portal: string) => string
): NodeLabel | null {
    if ((main.board as GenericBoard).draggingNode.value?.type === "portal") {
        const portal = (
            (main.board as GenericBoard).draggingNode.value?.state as unknown as PortalState
        ).id;
        const { maxConnections, portals } = node.state as unknown as BoosterState;
        if (portals.includes(portal)) {
            return { text: "Disconnect", color: "var(--accent2)" };
        }
        if (
            Decimal.add(maxConnections, main.computedBonusConnectionsModifier.value).lte(
                portals.length
            )
        ) {
            return { text: "Max connections", color: "var(--danger)" };
        }
        return {
            text: description(portal),
            color: "var(--accent2)"
        };
    }
    return null;
}

export function canAcceptResource(node: BoardNode, otherNode: BoardNode) {
    if (otherNode.type !== "resource") {
        return false;
    }
    const resource = (otherNode.state as unknown as ResourceState).type;
    const { maxConnections, resources } = node.state as unknown as DowsingState;
    if (resources.includes(resource)) {
        return true;
    }
    if (
        Decimal.add(maxConnections, main.computedBonusConnectionsModifier.value).lte(
            resources.length
        )
    ) {
        return false;
    }
    return true;
}

export function onDropResource(node: BoardNode, otherNode: BoardNode) {
    if (otherNode.type !== "resource") {
        return;
    }
    const resource = (otherNode.state as unknown as ResourceState).type;
    const resources = (node.state as unknown as { resources: Resources[] }).resources;
    if (resources.includes(resource)) {
        node.state = {
            ...(node.state as object),
            resources: resources.filter(r => r !== resource)
        };
    } else {
        node.state = {
            ...(node.state as object),
            resources: [...resources, resource]
        };
    }
    main.board.selectedNode.value = node;
}

export function canAcceptTool(node: BoardNode, otherNode: BoardNode) {
    if (otherNode.type !== "passive") {
        return false;
    }
    const passive = otherNode.state as Passives;
    const { maxConnections, tools } = node.state as unknown as EmpowererState;
    if (tools.includes(passive)) {
        return true;
    }
    if (
        Decimal.add(maxConnections, main.computedBonusConnectionsModifier.value).lte(tools.length)
    ) {
        return false;
    }
    return true;
}

export function onDropTool(node: BoardNode, otherNode: BoardNode) {
    if (otherNode.type !== "passive") {
        return;
    }
    const passive = otherNode.state as Passives;
    const tools = (node.state as unknown as { tools: Passives[] }).tools;
    if (tools.includes(passive)) {
        node.state = {
            ...(node.state as object),
            tools: tools.filter(r => r !== passive)
        };
    } else {
        node.state = {
            ...(node.state as object),
            tools: [...tools, passive]
        };
    }
    main.board.selectedNode.value = node;
}

export function canAcceptPortal(node: BoardNode, otherNode: BoardNode) {
    if (otherNode.type !== "portal") {
        return false;
    }
    const portal = (otherNode.state as unknown as PortalState).id;
    const { maxConnections, portals } = node.state as unknown as BoosterState;
    if (portals.includes(portal)) {
        return true;
    }
    if (
        Decimal.add(maxConnections, main.computedBonusConnectionsModifier.value).lte(portals.length)
    ) {
        return false;
    }
    return true;
}

export function onDropPortal(node: BoardNode, otherNode: BoardNode) {
    if (otherNode.type !== "portal") {
        return;
    }
    const portal = (otherNode.state as unknown as PortalState).id;
    const { portals } = node.state as unknown as BoosterState;
    if (portals.includes(portal)) {
        node.state = {
            ...(node.state as object),
            portals: portals.filter(r => r !== portal)
        };
    } else {
        node.state = {
            ...(node.state as object),
            portals: [...portals, portal]
        };
    }
    main.board.selectedNode.value = node;
}

export function isPowered(node: BoardNode): boolean {
    return node === main.board.selectedNode.value || (node.state as { powered: boolean }).powered;
}

export function isEmpowered(passive: Passives): boolean {
    return (
        main.empowerer.value != null &&
        isPowered(main.empowerer.value) &&
        (main.empowerer.value.state as unknown as EmpowererState).tools.includes(passive)
    );
}

export function getResourceLevelProgress(resource: Resources): number {
    const amount =
        (main.resourceNodes.value[resource]?.state as unknown as ResourceState | undefined)
            ?.amount ?? 0;
    const currentLevel = main.resourceLevels.value[resource];
    const requiredForCurrentLevel = resourceLevelFormula.evaluate(currentLevel);
    const requiredForNextLevel = resourceLevelFormula.evaluate(Decimal.add(currentLevel, 1));
    return Decimal.sub(amount, requiredForCurrentLevel)
        .max(0)
        .div(Decimal.sub(requiredForNextLevel, requiredForCurrentLevel))
        .toNumber();
}

export function checkConnections<T extends string>(
    bonusConnections: DecimalSource,
    node: ComputedRef<BoardNode | undefined>,
    connectionsName: T
) {
    if (node.value) {
        const state = node.value.state as unknown as { [K in T]: string[] } & {
            maxConnections: DecimalSource;
        };
        const currentConnections = state[connectionsName];
        const maxConnections = state.maxConnections;
        if (Decimal.gt(currentConnections.length, Decimal.add(maxConnections, bonusConnections))) {
            node.value.state = {
                ...(node.value.state as object),
                [connectionsName]: currentConnections.slice(
                    0,
                    Decimal.add(maxConnections, bonusConnections).toNumber()
                )
            };
        }
    }
}
