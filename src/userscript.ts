import { setPlatform, createUserscriptPlatform } from "./platform";
import { bootstrapMathchaToolkit } from "./script";

setPlatform(createUserscriptPlatform());
bootstrapMathchaToolkit();
