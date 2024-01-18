import inquirer from "inquirer";
import chalk from "chalk";
import sqlite3 from "sqlite3";
import fs from "fs";
import ezlion from "ezlion";

/** The prompt responses */
const responses = {
  runFound: "Found a run!",
  runsFound: "Found multiple runs!",
  noRunFound: "No runs have been found.",
};

/**The actions after entering a time */
const actionsFound = {
  view: "View run",
  restart: "Restart",
  exit: "Exit",
};

const actionsNotFound = {
  search: "Search for similar times",
  restart: "Restart",
  exit: "Exit",
};

const actionsFoundArray = Object.values(actionsFound);
const actionsNotFoundArray = Object.values(actionsNotFound);

/**The found run IDs when searching via time input*/
const runIDsFound = [];

const baseQuery =
  "SELECT Quests.*, PlayerGear.WeaponTypeID FROM Quests INNER JOIN PlayerGear ON Quests.RunID = PlayerGear.RunID WHERE Quests.FinalTimeDisplay = ?";

const runIDQuery = `
 SELECT 
   Quests.*, 
   PlayerGear.*, 
   AutomaticSkills.*, 
   CaravanSkills.*, 
   RoadDureSkills.*, 
   StyleRankSkills.*, 
   ZenithSkills.*,
   ActiveSkills.*
 FROM 
   Quests 
 LEFT JOIN 
   PlayerGear ON Quests.RunID = PlayerGear.RunID 
 LEFT JOIN 
   AutomaticSkills ON Quests.RunID = AutomaticSkills.RunID 
 LEFT JOIN 
   CaravanSkills ON Quests.RunID = CaravanSkills.RunID 
 LEFT JOIN 
   RoadDureSkills ON Quests.RunID = RoadDureSkills.RunID 
 LEFT JOIN 
   StyleRankSkills ON Quests.RunID = StyleRankSkills.RunID 
 LEFT JOIN 
   ZenithSkills ON Quests.RunID = ZenithSkills.RunID 
  LEFT JOIN 
  ActiveSkills ON Quests.RunID = ActiveSkills.RunID 
 WHERE 
   Quests.RunID = ?
`;

let files = fs.readdirSync(".").filter((file) => file.endsWith(".sqlite"));
let dbFilePath = files[0];

/** The time input*/
let timeInput = null;

const startingFramesRange = 90;
const framesRangeIncrease = 90;

/**The frame range from the entered time to search for when a run is not found.*/
let framesRange = startingFramesRange;
let minimumFrames = null;
let maximumFrames = null;

function resetValues() {
  timeInput = null;
  minimumFrames = null;
  maximumFrames = null;
  framesRange = startingFramesRange;
  runIDsFound.length = 0;
  console.log("Restarting...");
}

function getDate(inputString) {
  try {
    // Parse the input string as a Date object
    const inputDate = new Date(inputString);

    // Format the date in the desired output format
    const outputString = inputDate.toISOString().split("T")[0];

    return outputString; // Output: "2023-02-04"
  } catch (e) {
    return "????-??-??";
  }
}

/**30fps */
function getFramesFromMinutesSecondsMilliseconds(time) {
  const parts = time.split(":");
  const minutes = parseInt(parts[0], 10);
  const secondsAndMilliseconds = parts[1].split(".");
  const seconds = parseInt(secondsAndMilliseconds[0], 10);
  const milliseconds = parseInt(secondsAndMilliseconds[1], 10);

  const totalSeconds = minutes * 60 + seconds;
  const totalMilliseconds = totalSeconds * 1000 + milliseconds;
  const frames = Math.floor(totalMilliseconds / (1000 / 30)); // 30 fps
  return frames;
}

/**30fps */
function getMinutesSecondsMillisecondsFromFrames(frames) {
  const totalMilliseconds = frames * (1000 / 30); // 30 fps
  const totalSeconds = totalMilliseconds / 1000;

  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  const seconds = Math.floor(remainingSeconds);
  const milliseconds = Math.round((remainingSeconds - seconds) * 1000);

  // Format the result as a string "MM:SS.mmm"
  const result = `${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  return result;
}

function exitProgram(db) {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log("Closed database connection.");
    }
  });
  process.exit();
}

/** Check if user input is in the format of mm:ss.fff, where the minutes can be of any length*/
function isValidTime(time) {
  const regex = /^\d{2,}:\d{2}\.\d{3}$/;
  return regex.test(time);
}

/*Run IDs you want to view stats from, separated by spaces. Can be one number or multiple separated by spaces */
function isValidRunID(input) {
  const regex = /^(\d+\s+)*\d+$/;
  return regex.test(input);
}

async function selectRunData(runData, db) {
  if (runData.length === 1) {
    // If only one run was found, display its data.
    await showRunStats(db, runData[0].runID);
    // After runs are shown, prompt for the next action
    await promptNextAction(db);
    return;
  } else {
    // If multiple runs were found, prompt for the run IDs to show.
    const answer = await inquirer.prompt({
      name: "runIDs",
      type: "input",
      message:
        "Enter the run IDs you want to view stats from, separated by spaces:",
      validate: function (value) {
        return (
          isValidRunID(value) ||
          "Enter the run IDs you want to view stats from, separated by spaces."
        );
      },
    });

    // Make an array of run IDs from selected string input.
    const selectedRunIDs = answer.runIDs.split(" ").map(Number);

    // Then for each run ID, retrieve from the runIDsFound the corresponding data.
    await Promise.all(selectedRunIDs.map((runId) => showRunStats(db, runId)));

    // After runs are shown, prompt for the next action
    await promptNextAction(db);
    return;
  }
}

function getArmorHeadStats(pieceID, Slot1ID, Slot2ID, Slot3ID) {
  let pieceName = ezlion.ArmorHead[pieceID];
  let address = pieceID.toString(16).toUpperCase();
  return `${pieceName} (${address}) | ${getDecoName(Slot1ID)} | ${getDecoName(
    Slot2ID
  )} | ${getDecoName(Slot3ID)}`;
}

function getArmorChestStats(pieceID, Slot1ID, Slot2ID, Slot3ID) {
  let pieceName = ezlion.ArmorChest[pieceID];
  let address = pieceID.toString(16).toUpperCase();
  return `${pieceName} (${address}) | ${getDecoName(Slot1ID)} | ${getDecoName(
    Slot2ID
  )} | ${getDecoName(Slot3ID)}`;
}

function getArmorArmsStats(pieceID, Slot1ID, Slot2ID, Slot3ID) {
  let pieceName = ezlion.ArmorArms[pieceID];
  let address = pieceID.toString(16).toUpperCase();
  return `${pieceName} (${address}) | ${getDecoName(Slot1ID)} | ${getDecoName(
    Slot2ID
  )} | ${getDecoName(Slot3ID)}`;
}

function getArmorWaistStats(pieceID, Slot1ID, Slot2ID, Slot3ID) {
  let pieceName = ezlion.ArmorWaist[pieceID];
  let address = pieceID.toString(16).toUpperCase();
  return `${pieceName} (${address}) | ${getDecoName(Slot1ID)} | ${getDecoName(
    Slot2ID
  )} | ${getDecoName(Slot3ID)}`;
}

function getArmorLegsStats(pieceID, Slot1ID, Slot2ID, Slot3ID) {
  let pieceName = ezlion.ArmorLegs[pieceID];
  let address = pieceID.toString(16).toUpperCase();
  return `${pieceName} (${address}) | ${getDecoName(Slot1ID)} | ${getDecoName(
    Slot2ID
  )} | ${getDecoName(Slot3ID)}`;
}

function getItemData(itemID) {
  const name = ezlion.Item[itemID];
  const address = itemID.toString(16).toUpperCase();
  return `${name} (${address})`;
}

function getDecoName(id, slot = 0) {
  let decoName = "";
  let keyFound = id in ezlion.Item;
  if (keyFound) {
    decoName = ezlion.Item[id];
  }

  if (decoName === null || decoName === "None" || decoName === "") {
    decoName = "Empty";
  } else {
    decoName += "";
  }

  if (decoName === "Empty" && slot !== 0) {
    return getSigilName(slot);
  }

  let address = ` (${id.toString(16).toUpperCase()})`;

  return `${decoName}${address}`;
}

function getAutomaticArmorSkills(skill1, skill2, skill3, skill4, skill5) {
  let armorSkillName = "";
  let skills = [skill1, skill2, skill3, skill4, skill5];
  for (let i = 0; i < skills.length; i++) {
    let skillId = skills[i];
    let keyFound = skillId in ezlion.SkillArmor;

    if (keyFound) {
      let skillName = ezlion.SkillArmor[skillId];
      if (skillName !== "None" && skillName !== "") {
        armorSkillName += skillName;
        if (i !== skills.length - 1) {
          armorSkillName += ", ";
        }

        if (i % 5 === 4) {
          armorSkillName += "\n";
        }
      }
    }
  }

  if (armorSkillName === "") {
    return "None";
  }

  return armorSkillName;
}

function getCaravanSkills(skill1, skill2, skill3) {
  let caravanSkillName = "";
  let skills = [skill1, skill2, skill3];
  for (let i = 0; i < skills.length; i++) {
    let skillId = skills[i];
    let keyFound = skillId in ezlion.SkillCaravan;

    if (keyFound) {
      let skillName = ezlion.SkillCaravan[skillId];
      if (skillName !== "None" && skillName !== "") {
        caravanSkillName += skillName;
        if (i !== skills.length - 1) {
          caravanSkillName += ", ";
        }

        if (i % 5 === 4) {
          caravanSkillName += "\n";
        }
      }
    }
  }

  if (caravanSkillName === "") {
    return "None";
  }

  return caravanSkillName;
}

function getZenithSkills(
  skill1,
  skill2,
  skill3,
  skill4,
  skill5,
  skill6,
  skill7
) {
  let armorSkillName = "";
  let skills = [skill1, skill2, skill3, skill4, skill5, skill6, skill7];
  for (let i = 0; i < skills.length; i++) {
    let skillId = skills[i];
    let keyFound = skillId in ezlion.SkillZenith;

    if (keyFound) {
      let skillName = ezlion.SkillZenith[skillId];
      if (skillName !== "None" && skillName !== "") {
        armorSkillName += skillName;
        if (i !== skills.length - 1) {
          armorSkillName += ", ";
        }

        if (i % 5 === 4) {
          armorSkillName += "\n";
        }
      }
    }
  }

  if (armorSkillName === "") {
    return "None";
  }

  return armorSkillName;
}

function getGSRSkills(skill1, skill2) {
  let styleRankSkillName = "";
  let skills = [skill1, skill2];
  for (let i = 0; i < skills.length; i++) {
    let skillId = skills[i];
    let keyFound = skillId in ezlion.SkillStyleRank;
    if (keyFound) {
      let skillName = ezlion.SkillStyleRank[skillId];
      if (skillName !== "None" && skillName !== "") {
        styleRankSkillName += skillName;
        if (i !== skills.length - 1) {
          styleRankSkillName += ", ";
        }

        if (i % 5 === 4) {
          styleRankSkillName += "\n";
        }
      }
    }
  }

  if (styleRankSkillName === "") {
    return "None";
  }

  return styleRankSkillName;
}

function getItems(items) {
  let sb = "";
  let counter = 0;
  for (let i = 0; i < items.length; i++) {
    let id = items[i];
    let keyFound = id in ezlion.Item;

    if (keyFound) {
      let value = ezlion.Item[id];
      if (value !== "None" && value !== "") {
        sb += value;
        counter++;
        if (counter % 5 === 0) {
          sb += "\n";
        } else if (i !== items.length - 1) {
          sb += ", ";
        }
      }
    }
  }

  if (sb === "") {
    return "None";
  }

  return sb;
}

function getRoadDureSkills(skills, levels) {
  let name = "";
  for (let i = 0; i < skills.length; i++) {
    let id = skills[i];
    let level = levels[i];
    let keyFound = id in ezlion.SkillRoadTower;
    if (keyFound) {
      let value = ezlion.SkillRoadTower[id];
      if (value !== "None" && value !== "") {
        // Return the skill and level in the format of ${skillName} LV${level}
        name += `${value} LV${level}`;
        if (i !== skills.length - 1) {
          name += ", ";
        }

        if (i % 5 === 4) {
          name += "\n";
        }
      }
    }
  }

  return name === "" ? "None" : name;
}

function getArmorSkills(
  skill1,
  skill2,
  skill3,
  skill4,
  skill5,
  skill6,
  skill7,
  skill8,
  skill9,
  skill10,
  skill11,
  skill12,
  skill13,
  skill14,
  skill15,
  skill16,
  skill17,
  skill18,
  skill19
) {
  let armorSkillName = "";
  let skills = [
    skill1,
    skill2,
    skill3,
    skill4,
    skill5,
    skill6,
    skill7,
    skill8,
    skill9,
    skill10,
    skill11,
    skill12,
    skill13,
    skill14,
    skill15,
    skill16,
    skill17,
    skill18,
    skill19,
  ];
  for (let i = 0; i < skills.length; i++) {
    let skillId = skills[i];
    let keyFound = skillId in ezlion.SkillArmor;

    if (keyFound) {
      let skillName = ezlion.SkillArmor[skillId];
      if (skillName !== "None" && skillName !== "") {
        armorSkillName += skillName;
        if (i !== skills.length - 1) {
          armorSkillName += ", ";
        }

        if (i % 5 === 4) {
          armorSkillName += "\n";
        }
      }
    }
  }

  if (armorSkillName === "") {
    return "None";
  }

  return armorSkillName;
}

function displayRunStats(run) {
  let inventory = JSON.parse(run.PlayerInventoryDictionary);
  let ammoPouch = JSON.parse(run.PlayerAmmoPouchDictionary);
  let partnyaBag = JSON.parse(run.PartnyaBagDictionary);

  let lastInventoryEntry =
    Object.entries(inventory)[Object.keys(inventory).length - 1];
  let lastAmmoPouchEntry =
    Object.entries(ammoPouch)[Object.keys(ammoPouch).length - 1];
  let lastPartnyaBagEntry =
    Object.entries(partnyaBag)[Object.keys(partnyaBag).length - 1];

  let inventoryItems = lastInventoryEntry[1].flatMap(Object.keys).map(Number);
  let ammoPouchItems = lastAmmoPouchEntry[1].flatMap(Object.keys).map(Number);
  let partnyaBagItems = lastPartnyaBagEntry[1].flatMap(Object.keys).map(Number);

  console.log(`
${run.CreatedBy} ${ezlion.WeaponClass[run.WeaponClassID]}

${ezlion.WeaponType[run.WeaponTypeID]}: ${
    run.BlademasterWeaponID
      ? ezlion.WeaponBlademaster[run.BlademasterWeaponID]
      : ezlion.WeaponGunner[run.GunnerWeaponID]
  } (${
    run.BlademasterWeaponID
      ? run.BlademasterWeaponID.toString(16).toUpperCase()
      : run.GunnerWeaponID.toString(16).toUpperCase()
  }) | ${ezlion.WeaponStyle[run.StyleID]}
${run.WeaponSlot1} | ${run.WeaponSlot2} | ${run.WeaponSlot3}
Head: ${getArmorHeadStats(
    run.HeadID,
    run.HeadSlot1ID,
    run.HeadSlot2ID,
    run.HeadSlot3ID
  )}
Chest: ${getArmorChestStats(
    run.ChestID,
    run.ChestSlot1ID,
    run.ChestSlot2ID,
    run.ChestSlot3ID
  )}
Arms: ${getArmorArmsStats(
    run.ArmsID,
    run.ArmsSlot1ID,
    run.ArmsSlot2ID,
    run.ArmsSlot3ID
  )}
Waist: ${getArmorWaistStats(
    run.WaistID,
    run.WaistSlot1ID,
    run.WaistSlot2ID,
    run.WaistSlot3ID
  )}
Legs: ${getArmorLegsStats(
    run.LegsID,
    run.LegsSlot1ID,
    run.LegsSlot2ID,
    run.LegsSlot3ID
  )}
Cuffs: ${getItemData(run.Cuff1ID)} | ${getItemData(run.Cuff2ID)}

Run Date: ${run.CreatedAt} | Run Hash: ${run.QuestHash}}

Zenith Skills:
${getZenithSkills(
  run.ZenithSkill1ID,
  run.ZenithSkill2ID,
  run.ZenithSkill3ID,
  run.ZenithSkill4ID,
  run.ZenithSkill5ID,
  run.ZenithSkill6ID,
  run.ZenithSkill7ID
)}

Automatic Skills:
${getAutomaticArmorSkills(
  run.AutomaticSkill1ID,
  run.AutomaticSkill2ID,
  run.AutomaticSkill3ID,
  run.AutomaticSkill4ID,
  run.AutomaticSkill5ID
)}

Active Skills:
${getArmorSkills(
  run.ActiveSkill1ID,
  run.ActiveSkill2ID,
  run.ActiveSkill3ID,
  run.ActiveSkill4ID,
  run.ActiveSkill5ID,
  run.ActiveSkill6ID,
  run.ActiveSkill7ID,
  run.ActiveSkill8ID,
  run.ActiveSkill9ID,
  run.ActiveSkill10ID,
  run.ActiveSkill11ID,
  run.ActiveSkill12ID,
  run.ActiveSkill13ID,
  run.ActiveSkill14ID,
  run.ActiveSkill15ID,
  run.ActiveSkill16ID,
  run.ActiveSkill17ID,
  run.ActiveSkill18ID,
  run.ActiveSkill19ID
)}

Caravan Skills:
${getCaravanSkills(run.CaravanSkill1ID, run.CaravanSkill2ID)}

Diva Skill:
${ezlion.SkillDiva[run.DivaSkillID]}

Guild Food:
${ezlion.SkillArmor[run.GuildFoodID]}

Style Rank:
${getGSRSkills(run.StyleRankSkill1ID, run.StyleRankSkill2ID)}

Items:
${getItems(inventoryItems)}

Ammo:
${getItems(ammoPouchItems)}

Partnya Bag:
${getItems(partnyaBagItems)}

Poogie Item:
${ezlion.Item[run.PoogieItemID]}

Road/Duremudira Skills:
${getRoadDureSkills(
  [
    run.RoadDureSkill1ID,
    run.RoadDureSkill2ID,
    run.RoadDureSkill3ID,
    run.RoadDureSkill4ID,
    run.RoadDureSkill5ID,
    run.RoadDureSkill6ID,
    run.RoadDureSkill7ID,
    run.RoadDureSkill8ID,
    run.RoadDureSkill9ID,
    run.RoadDureSkill10ID,
    run.RoadDureSkill11ID,
    run.RoadDureSkill12ID,
    run.RoadDureSkill13ID,
    run.RoadDureSkill14ID,
    run.RoadDureSkill15ID,
    run.RoadDureSkill16ID,
  ],
  [
    run.RoadDureSkill1Level,
    run.RoadDureSkill2Level,
    run.RoadDureSkill3Level,
    run.RoadDureSkill4Level,
    run.RoadDureSkill5Level,
    run.RoadDureSkill6Level,
    run.RoadDureSkill7Level,
    run.RoadDureSkill8Level,
    run.RoadDureSkill9Level,
    run.RoadDureSkill10Level,
    run.RoadDureSkill11Level,
    run.RoadDureSkill12Level,
    run.RoadDureSkill13Level,
    run.RoadDureSkill14ILevel,
    run.RoadDureSkill15Level,
    run.RoadDureSkill16Level,
  ]
)}

Quest: ${ezlion.Quest[run.QuestID]}
${ezlion.ObjectiveType[run.ObjectiveTypeID]} ${run.ObjectiveQuantity} ${
    run.ObjectiveName
  }
Category: ${run.ActualOverlayMode}
Party Size: ${run.PartySize}
`);
}

function showRunStats(db, runID) {
  return new Promise((resolve, reject) => {
    db.all(runIDQuery, runID, (err, rows) => {
      if (err) {
        console.error(err.message);
        reject(0);
      }

      if (rows.length === 1) {
        let runID = rows[0].RunID;
        console.log(
          `
========================================================================================
========================================================================================
========================================================================================

Run ID: ${runID}
`
        );
        displayRunStats(rows[0]);
        resolve(rows.length);
      } else {
        console.error(`No rows found for run ID ${params}.`);
        reject(0);
      }
    });
  });
}

function findRuns(db, query, params) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error(err.message);
        reject(0);
      }

      if (rows.length > 0) {
        runIDsFound.push(
          ...rows.map((row) => {
            return {
              runID: row.RunID,
              time: row.FinalTimeDisplay,
              date: getDate(row.CreatedAt),
              objective: row.ObjectiveName,
              category: row.ActualOverlayMode,
              questID: row.QuestID,
              weapon: ezlion.WeaponType[row.WeaponTypeID],
              partySize: row.PartySize,
            };
          })
        );
        console.table(runIDsFound);
        if (rows.length === 1) {
          console.log(responses.runFound);
        } else {
          console.log(responses.runsFound);
        }
        resolve(rows.length);
      } else {
        console.log(responses.noRunFound);
        if (minimumFrames !== null && maximumFrames !== null) {
          console.log(
            `Current time search range: ${getMinutesSecondsMillisecondsFromFrames(
              minimumFrames
            )} to ${getMinutesSecondsMillisecondsFromFrames(maximumFrames)}`
          );
        }
        resolve(0);
      }
    });
  });
}

async function promptNextAction(db) {
  const actionPrompt = await inquirer.prompt({
    type: "list",
    name: "option",
    message: "Select an action:",
    choices: ["View another run", "Restart", "Exit"],
  });

  switch (actionPrompt.option) {
    case "View another run":
      // Call selectRunData to allow viewing another run
      selectRunData([0, 0], db);
      break;
    case "Restart":
      resetValues();
      await mainLoop(db);
      break;
    case "Exit":
      exitProgram(db);
      break;
  }
}

async function mainLoop(db = null) {
  if (files.length === 0) {
    console.error(
      "Database not found, please place the database in the same directory as the program"
    );
    process.exit();
  }

  if (db === null) {
    db = new sqlite3.Database(
      `./${dbFilePath}`,
      sqlite3.OPEN_READONLY,
      (err) => {
        if (err) {
          console.error(err.message);
          process.exit();
        }
      }
    );
  }

  const time = await inquirer.prompt({
    name: "elapsed",
    type: "input",
    message: "Enter minutes, seconds and milliseconds of the run (mm:ss.fff)",
    validate: function (value) {
      return (
        isValidTime(value) ||
        "Required fields must be in the format of mm:ss.fff"
      );
    },
  });

  timeInput = time.elapsed;
  const frames = getFramesFromMinutesSecondsMilliseconds(timeInput);

  let runFound = await findRuns(db, baseQuery, [`${timeInput}`]);
  while (!runFound) {
    const actionPrompt = await inquirer.prompt({
      type: "list",
      name: "option",
      message: "Select an action:",
      choices: actionsNotFoundArray,
    });

    switch (actionPrompt.option) {
      case "Search for similar times":
        minimumFrames = Math.max(0, frames - framesRange);
        maximumFrames = frames + framesRange;

        const query = `SELECT Quests.*, PlayerGear.WeaponTypeID FROM Quests INNER JOIN PlayerGear ON Quests.RunID = PlayerGear.RunID WHERE Quests.FinalTimeValue BETWEEN ? AND ?`;
        runFound = await findRuns(db, query, [minimumFrames, maximumFrames]);
        framesRange += framesRangeIncrease;
        break;
      case "Restart":
        resetValues();
        await mainLoop(db);
        return; // Exit the while loop as mainLoop restarts the process
      case "Exit":
        exitProgram(db);
        return; // Exit the while loop as the program is exiting
    }
  }

  const actionPrompt = await inquirer.prompt({
    type: "list",
    name: "option",
    message: "Select an action:",
    choices: actionsFoundArray,
  });

  switch (actionPrompt.option) {
    case "View run":
      selectRunData(runIDsFound, db);
      break;
    case "Restart":
      resetValues();
      await mainLoop(db);
      return;
    case "Exit":
      exitProgram(db);
      return;
  }
}

mainLoop();
