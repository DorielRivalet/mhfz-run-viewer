import inquirer from "inquirer";
import chalk from "chalk";
import sqlite3 from "sqlite3";
import fs from "fs";

// TODO port from ezlion
const weaponTypes = [
  "Great Sword",
  "Heavy Bowgun",
  "Hammer",
  "Lance",
  "Sword and Shield",
  "Light Bowgun",
  "Dual Swords",
  "Long Sword",
  "Hunting Horn",
  "Gunlance",
  "Bow",
  "Tonfa",
  "Switch Axe F",
  "Magnet Spike",
];

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
const runIDQuery =
  "SELECT Quests.*, PlayerGear.WeaponTypeID FROM Quests INNER JOIN PlayerGear ON Quests.RunID = PlayerGear.RunID WHERE Quests.RunID = ?";

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

function showRunStats(db, runID) {
  return new Promise((resolve, reject) => {
    db.all(runIDQuery, runID, (err, rows) => {
      if (err) {
        console.error(err.message);
        reject(0);
      }

      const stats = [];

      if (rows.length > 0) {
        stats.push(
          ...rows.map((row) => {
            return {
              runID: row.RunID,
              time: row.FinalTimeDisplay,
              date: getDate(row.CreatedAt),
              objective: row.ObjectiveName,
              category: row.ActualOverlayMode,
              questID: row.QuestID,
              weapon: weaponTypes[row.WeaponTypeID],
              partySize: row.PartySize,
            };
          })
        );
        console.table(stats);
        resolve(rows.length);
      } else {
        console.error(`No rows found for run ID ${params}.`);
        reject(0);
      }
    });
  });
}

function findRun(db, query, params) {
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
              weapon: weaponTypes[row.WeaponTypeID],
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

  let runFound = await findRun(db, baseQuery, [`${timeInput}`]);
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
        runFound = await findRun(db, query, [minimumFrames, maximumFrames]);
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
