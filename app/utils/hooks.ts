import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();

  return collectModelsWithDefaultModel(
    configStore.models,
    configStore.customModels ? configStore.customModels : accessStore.customModels || "",
    accessStore.defaultModel,
  );
}

export function useServerCustomModels() {
  const accessStore = useAccessStore();
  return accessStore.customModels;
}
