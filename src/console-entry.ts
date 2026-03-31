import { setPlatform, createConsolePlatform } from "./platform";
import { bootstrapMathchaToolkit } from "./script";

setPlatform(createConsolePlatform());
bootstrapMathchaToolkit();
