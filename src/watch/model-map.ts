import { FactPath } from '../storage';
import { findIndex } from '../util/fn';

function factPathMatches(path: FactPath): (pair: { factPath: FactPath }) => boolean {
    return pair => {
        if (pair.factPath.length === path.length) {
            for (let i = 0; i < pair.factPath.length; i++) {
                if (pair.factPath[i].hash !== path[i].hash ||
                    pair.factPath[i].type !== path[i].type) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
}

export class ModelMap<Model> {
    private modelOrActionByFactPath: { factPath: FactPath, satisfied: boolean, modelOrAction: (Model | ((model: Model) => void)) }[] = [];

    withModel(path: FactPath, action: (model: Model) => void) {
        const pair = this.modelOrActionByFactPath.find(factPathMatches(path));
        if (!pair) {
            this.modelOrActionByFactPath.push({ factPath: path, satisfied: false, modelOrAction: action });
        }
        else {
            if (!pair.satisfied) {
                const prior = <(model: Model) => void>pair.modelOrAction;
                pair.modelOrAction = (model: Model) => {
                    prior(model);
                    action(model);
                }
            }
            else {
                const prior = <Model>pair.modelOrAction;
                action(prior);
            }
        }
    }

    setModel(path: FactPath, model: Model) {
        const pair = this.modelOrActionByFactPath.find(factPathMatches(path));
        if (!pair) {
            this.modelOrActionByFactPath.push({ factPath: path, satisfied: true, modelOrAction: model });
        }
        else {
            if (!pair.satisfied) {
                const prior = <(model: Model) => void>pair.modelOrAction;
                pair.modelOrAction = model;
                pair.satisfied = true;
                prior(model);
            }
            else {
                throw new Error('Setting the model twice on path ' + JSON.stringify(path));
            }
        }
    }

    hasModel(path: FactPath) {
        const pair = this.modelOrActionByFactPath.find(factPathMatches(path));
        return pair !== undefined && pair.satisfied;
    }

    removeModel(path: FactPath): Model | null {
        const removedIndex = findIndex(this.modelOrActionByFactPath, factPathMatches(path));
        if (removedIndex >= 0) {
            const pair = this.modelOrActionByFactPath[removedIndex];
            this.modelOrActionByFactPath.splice(removedIndex, 1);
            if (pair.satisfied) {
                return <Model>pair.modelOrAction;
            }
        }
        return null;
    }
}
