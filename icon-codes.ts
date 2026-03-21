interface IconMapping {
  iconCode: string;
  labels: string[];
}

function extractIconCodesRecursive(data: any, results: IconMapping[] = []): IconMapping[] {
  // Skip if not an object or array
  if (!data || typeof data !== "object") {
    return results;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    data.forEach((item) => extractIconCodesRecursive(item, results));
    return results;
  }

  // Look for iconCode in current object
  if ("iconCode" in data && "condition" in data) {
    const condition = data.condition;
    if (typeof condition === "string" && condition.length > 0) {
      // Add to results if we haven't seen this iconCode+condition combination
      const existingMapping = results.find((r) => r.iconCode === data.iconCode);
      if (existingMapping) {
        // Add new unique condition
        if (!existingMapping.labels.includes(condition)) {
          existingMapping.labels.push(condition);
        }
      } else if (data.iconCode) {
        results.push({
          iconCode: data.iconCode,
          labels: [condition],
        });
      }
    }
  }

  // Recursively process all object properties
  Object.values(data).forEach((value) => extractIconCodesRecursive(value, results));

  return results;
}

function loadAndProcessFile(filePath: string): Promise<IconMapping[]> {
  try {
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Promise.resolve(extractIconCodesRecursive(data));
  } catch (error) {
    return Promise.reject(`Error processing ${filePath}: ${error.message}`);
  }
}

// Example usage:
async function processIconCodes() {
  try {
    const fs = require("fs");
    const path = require("path");

    // Find all api-data*.json files in current directory
    const files = fs
      .readdirSync(".")
      .filter((file) => file.startsWith("api-data") && file.endsWith(".json"));

    const allResults: IconMapping[] = [];

    for (const file of files) {
      const results = await loadAndProcessFile(file);
      results.forEach((mapping) => {
        const existing = allResults.find((r) => r.iconCode === mapping.iconCode);
        if (existing) {
          // Merge labels
          mapping.labels.forEach((label) => {
            if (!existing.labels.includes(label)) {
              existing.labels.push(label);
            }
          });
        } else {
          allResults.push(mapping);
        }
      });
    }

    // Sort by iconCode for consistent output
    allResults.sort((a, b) => a.iconCode.localeCompare(b.iconCode));

    console.log("Found icon codes and their labels:");
    console.log(JSON.stringify(allResults, null, 2));

    return allResults;
  } catch (error) {
    console.error("Error:", error);
    return [];
  }
}

// Run the script
processIconCodes();
