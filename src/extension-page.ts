import { setPlatform, createExtensionPlatform } from "./platform";
import { bootstrapMathchaToolkit } from "./script";

setPlatform(createExtensionPlatform());
bootstrapMathchaToolkit();
