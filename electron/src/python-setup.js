// python-setup.js
const { app, dialog } = require('electron');
const { exec, execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Checks Python version compatibility
 * @returns {Object} Object with compatibility info and version details
 */
function checkPythonVersion() {
  try {
    const versionOutput = execSync('python3 --version', { encoding: 'utf8' });
    const versionMatch = versionOutput.match(/Python (\d+)\.(\d+)\.\d+/);
    
    if (versionMatch) {
      const major = parseInt(versionMatch[1], 10);
      const minor = parseInt(versionMatch[2], 10);
      
      console.log(`Detected Python ${major}.${minor}`);

      // spotdl requires Python 3.10+ (yt-dlp dependency)
      if (major === 3 && minor >= 10) {
        return { compatible: true, version: `${major}.${minor}` };
      } else if (major === 3 && minor < 10) {
        return {
          compatible: false,
          version: `${major}.${minor}`,
          message: 'Python version is too old. spotdl requires Python 3.10 or newer. Please install from https://www.python.org/downloads/'
        };
      } else {
        return {
          compatible: false,
          version: `${major}.${minor}`,
          message: `Detected Python ${major}.${minor}. spotdl requires Python 3.10 or newer.`
        };
      }
    } else {
      return { 
        compatible: false,
        version: 'unknown',
        message: 'Unable to determine Python version.'
      };
    }
  } catch (error) {
    console.error('Error checking Python version:', error);
    return { 
      compatible: false,
      version: 'not found',
      message: 'Python 3 not found or not accessible. Please install Python 3.10 or newer from https://www.python.org/downloads/'
    };
  }
}

/**
 * Checks if FFmpeg is installed
 * @returns {Boolean} True if FFmpeg is available, false otherwise
 */
function checkFFmpeg() {
  try {
    // First check for the bundled ffmpeg binary
    const appRoot = app.isPackaged 
      ? path.dirname(app.getAppPath())
      : path.resolve(__dirname, '../..');
      
    // In packaged app, ffmpeg is at different locations depending on platform
    let ffmpegPath;
    
    if (app.isPackaged) {
      if (process.platform === 'darwin') {
        // On macOS, resources are in the .app bundle
        ffmpegPath = path.join(process.resourcesPath, 'ffmpeg');
      } else if (process.platform === 'win32') {
        // On Windows, resources are in the resources directory
        ffmpegPath = path.join(process.resourcesPath, 'ffmpeg.exe');
      } else {
        // On Linux, resources are in the resources directory
        ffmpegPath = path.join(process.resourcesPath, 'ffmpeg');
      }
    } else {
      // In development, use the binary from the python/bin directory
      ffmpegPath = path.join(appRoot, 'electron', 'python', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    }
    
    console.log('Checking for FFmpeg at:', ffmpegPath);
    
    if (fs.existsSync(ffmpegPath)) {
      console.log('Found bundled FFmpeg');

      try {
        // Test if the binary is executable
        fs.chmodSync(ffmpegPath, '755');
        execSync(`"${ffmpegPath}" -version`, { stdio: 'ignore' });

        // Store the path for later use when running spotdl
        global.ffmpegPath = ffmpegPath;
        return true;
      } catch (bundledError) {
        console.warn('Bundled FFmpeg found but not functional:', bundledError.message);
      }
    }
    
    // Fall back to system ffmpeg if bundled one is not found
    console.log('Bundled FFmpeg not found, checking system installation');
    // Ensure Homebrew paths are included for the check
    const envWithPath = {
      ...process.env,
      PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`
    };
    
    // Try to locate FFmpeg in common directories
    const commonFFmpegPaths = [
      '/opt/homebrew/bin/ffmpeg',     // M1 Mac Homebrew location
      '/usr/local/bin/ffmpeg',        // Intel Mac / standard Homebrew location
      '/usr/bin/ffmpeg'               // System location
    ];
    
    for (const ffPath of commonFFmpegPaths) {
      if (fs.existsSync(ffPath)) {
        console.log(`Found system FFmpeg at: ${ffPath}`);
        global.ffmpegPath = ffPath;
        return true;
      }
    }
    
    // If we couldn't find it in common paths, try generic command
    try {
      execSync('ffmpeg -version', { stdio: 'ignore', env: envWithPath });
      return true;
    } catch (ffError) {
      console.error('FFmpeg check failed:', ffError.message);
      return false;
    }
  } catch (error) {
    console.error('FFmpeg check failed:', error.message);
    return false;
  }
}

/**
 * Sets up the Python environment
 * @param {Object} splashWindowContents - The webContents of the splash window to send progress updates
 * @returns {Promise} Resolves when setup is complete
 */
async function setupPythonEnvironment(splashWindowContents) {
  return new Promise((resolve, reject) => {
    console.log('Setting up Python environment...');
    
    // Determine paths based on whether the app is packaged or in development
    let setupScriptPath, requirementsPath;
    
    if (app.isPackaged) {
      // When packaged, use resources directory
      setupScriptPath = path.join(process.resourcesPath, 'scripts', 'setup_venv.sh');
      requirementsPath = path.join(process.resourcesPath, 'scripts', 'requirements.txt');
    } else {
      // In development, use relative paths
      setupScriptPath = path.join(__dirname, '..', 'python', 'setup_venv.sh');
      requirementsPath = path.join(__dirname, '..', 'python', 'requirements.txt');
    }
    
    console.log('Setup script path:', setupScriptPath);
    console.log('Requirements path:', requirementsPath);

    // Check if setup script exists
    if (!fs.existsSync(setupScriptPath)) {
      const errorMessage = `Setup script not found at: ${setupScriptPath}`;
      console.error(errorMessage);
      if (splashWindowContents) {
        splashWindowContents.send('setup-progress', {
          status: 'Setup Error',
          progress: 0,
          message: errorMessage
        });
      }
      reject(new Error(errorMessage));
      return;
    }

    // Check if requirements file exists
    if (!fs.existsSync(requirementsPath)) {
      const errorMessage = `Requirements file not found at: ${requirementsPath}`;
      console.error(errorMessage);
      if (splashWindowContents) {
        splashWindowContents.send('setup-progress', {
          status: 'Setup Error',
          progress: 0,
          message: errorMessage
        });
      }
      reject(new Error(errorMessage));
      return;
    }

    // Create an organized folder structure
    // In packaged app, use the user data directory which has write permissions
    // In development, use the project directory
    const userDataDir = app.getPath('userData');
    const appRoot = app.isPackaged 
      ? userDataDir
      : path.resolve(__dirname, '../..');
    
    // Create a dedicated spotwire data directory
    const spotWireDataDir = app.isPackaged
      ? path.join(userDataDir, 'spotwire_data')
      : path.resolve(__dirname, '../..', 'spotwire_data');
    
    // Create the spotwire data directory if it doesn't exist
    if (!fs.existsSync(spotWireDataDir)) {
      try {
        fs.mkdirSync(spotWireDataDir, { recursive: true });
        console.log('Created spotwire data directory:', spotWireDataDir);
      } catch (error) {
        console.error('Failed to create spotwire data directory:', error);
        reject(error);
        return;
      }
    }
    
    // Create dedicated directories for different components
    const venvDir = path.join(spotWireDataDir, 'venv');
    const pythonDir = path.join(spotWireDataDir, 'python');
    
    // Store paths in global variables for later use
    global.spotWireDataDir = spotWireDataDir;
    global.venvPath = venvDir;
    
    console.log('Spotwire data directory:', spotWireDataDir);
    console.log('Virtual environment path:', venvDir);
    console.log('Python directory:', pythonDir);
    
    // Create python directory if it doesn't exist
    if (!fs.existsSync(pythonDir)) {
      try {
        fs.mkdirSync(pythonDir, { recursive: true });
        console.log('Created python directory:', pythonDir);
      } catch (error) {
        console.error('Failed to create python directory:', error);
        reject(error);
        return;
      }
    }

    // Make setup script executable
    try {
      fs.chmodSync(setupScriptPath, '755');
    } catch (error) {
      console.error('Failed to make setup script executable:', error);
      // Continue anyway, as it might already be executable
    }
    
    // Create environment variables with adjusted paths
    const setupEnv = { 
      ...process.env, 
      PYTHONUNBUFFERED: '1',
      VENV_PATH: global.venvPath  // Pass the venv path to the script
    };
    
    // For Windows, we need a different approach
    if (process.platform === 'win32') {
      try {
        // On Windows, create the virtual environment using Python directly
        console.log('Creating virtual environment on Windows...');
        
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Installing required components...',
            progress: 20,
            message: 'Creating virtual environment...'
          });
        }
        
        // First make sure Python is available
        execSync('python --version', { stdio: 'ignore' });
        
        // Create the virtual environment
        execSync(`python -m venv "${venvDir}"`, { stdio: 'pipe' });
        
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Installing required components...',
            progress: 40,
            message: 'Installing packages...'
          });
        }
        
        // Install required packages
        const pipPath = path.join(venvDir, 'Scripts', 'pip.exe');
        execSync(`"${pipPath}" install --upgrade pip`, { stdio: 'pipe' });
        execSync(`"${pipPath}" install --upgrade wheel setuptools`, { stdio: 'pipe' });
        
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Installing required components...',
            progress: 60,
            message: 'Installing spotdl and dependencies...'
          });
        }

        // Use --upgrade to ensure outdated packages (e.g. yt-dlp) get updated
        execSync(`"${pipPath}" install --upgrade -r "${requirementsPath}"`, { stdio: 'pipe' });

        // yt-dlp is a rolling release that breaks on YouTube-side changes; always
        // pull the very latest on launch so downloads keep working without an app
        // release. Mirrors the yt-dlp upgrade in setup_venv.sh for macOS/Linux.
        execSync(`"${pipPath}" install --upgrade yt-dlp`, { stdio: 'pipe' });

        console.log('Virtual environment setup completed successfully');
        
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Setup Complete!',
            progress: 100,
            message: 'Starting app...'
          });
        }
        
        // Short delay to show completion before closing splash
        setTimeout(() => {
          resolve();
        }, 1000);
        
        return;
      } catch (error) {
        console.error('Error setting up Python environment on Windows:', error);
        
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Setup Failed',
            progress: 0,
            message: `Error: ${error.message}`
          });
        }
        
        dialog.showErrorBox(
          'Python Environment Setup Failed',
          `Failed to set up the Python environment on Windows.\n\n${error.message}\n\nPlease make sure Python is installed properly.`
        );
        
        reject(error);
        return;
      }
    }
    
    // For macOS and Linux, use the bash script
    // Execute setup script with the requirements file path
    const setupProcess = spawn('bash', [setupScriptPath, requirementsPath], {
      cwd: pythonDir,
      env: setupEnv
    });
    
    let output = '';
    let errorOutput = '';
    let setupProgress = 10;
    
    // Handle stdout data
    setupProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log('Setup output:', text);
      
      // Update progress based on output
      if (text.includes('Creating virtual environment')) {
        setupProgress = 20;
      } else if (text.includes('Installing required packages')) {
        setupProgress = 40;
      } else if (text.includes('pip install --upgrade pip')) {
        setupProgress = 60;
      } else if (text.includes('Installing wheel and setuptools')) {
        setupProgress = 70;
      } else if (text.includes('pip install -r')) {
        setupProgress = 80;
      }
      
      // Update splash screen
      if (splashWindowContents) {
        splashWindowContents.send('setup-progress', {
          status: 'Installing required components...',
          progress: setupProgress,
          message: text.trim()
        });
      }
    });
    
    // Handle stderr data
    setupProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.error('Setup error:', text);
      
      // Also send stderr to the splash screen for visibility
      if (splashWindowContents) {
        splashWindowContents.send('setup-progress', {
          status: 'Installing required components...',
          progress: setupProgress,
          message: `Error: ${text.trim()}`
        });
      }
    });
    
    // Handle completion
    setupProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Setup completed successfully');
        
        // Update splash screen
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Setup Complete!',
            progress: 100,
            message: 'Starting app...'
          });
        }
        
        // Short delay to show completion before closing splash
        setTimeout(() => {
          resolve();
        }, 1000);
      } else {
        const errorMsg = `Setup failed with code ${code}. Check for Python 3.12 compatibility issues.\n\nError output: ${errorOutput}`;
        console.error(errorMsg);
        
        if (splashWindowContents) {
          splashWindowContents.send('setup-progress', {
            status: 'Setup Failed',
            progress: 0,
            message: errorMsg
          });
        }
        
        // Show a dialog with more detailed error information
        dialog.showErrorBox(
          'Python Environment Setup Failed',
          `The application failed to set up the Python environment.\n\n${errorMsg}\n\nPlease check that Python 3.10 or newer is installed on your system.`
        );
        
        reject(new Error(errorMsg));
      }
    });
    
    // Handle errors
    setupProcess.on('error', (err) => {
      const errorMsg = `Failed to start setup process: ${err.message}`;
      console.error(errorMsg);
      
      if (splashWindowContents) {
        splashWindowContents.send('setup-progress', {
          status: 'Setup Error',
          progress: 0,
          message: errorMsg
        });
      }
      
      dialog.showErrorBox(
        'Python Environment Setup Error',
        `Failed to start the Python environment setup process.\n\n${errorMsg}\n\nPlease check that bash and Python 3 are available on your system.`
      );
      
      reject(err);
    });
  });
}

/**
 * Gets the default downloads folder
 * @returns {String} Path to the default downloads folder
 */
function getDefaultDownloadsFolder() {
  // Use the spotwire data directory or create a new path
  const spotWireDataDir = global.spotWireDataDir || (
    app.isPackaged 
      ? path.join(app.getPath('userData'), 'spotwire_data')
      : path.resolve(__dirname, '../..', 'spotwire_data')
  );
  
  // Create a downloads folder within the data directory
  const downloadsFolder = path.join(spotWireDataDir, 'downloads');
  
  // Create it if it doesn't exist
  if (!fs.existsSync(downloadsFolder)) {
    try {
      fs.mkdirSync(downloadsFolder, { recursive: true });
      console.log('Created downloads directory:', downloadsFolder);
    } catch (error) {
      console.error('Failed to create downloads directory:', error);
      // Fall back to user's downloads folder if we can't create our own
      return app.getPath('downloads');
    }
  }
  
  return downloadsFolder;
}

module.exports = {
  checkPythonVersion,
  checkFFmpeg,
  setupPythonEnvironment,
  getDefaultDownloadsFolder
}; 