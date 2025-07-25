import fs from 'fs'

import * as core from '@actions/core'
import { exec } from '@actions/exec'
import { HttpClient } from '@actions/http-client'
import * as toolCache from '@actions/tool-cache'

import {
  binaryName,
  githubRepository,
  toolName,
  defaultVersion,
  extractBinary,
  getVersionArguments
} from './tool.js'
import axios, { isAxiosError } from 'axios'

async function validateSubscription(): Promise<void> {
  const API_URL = `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/subscription`

  try {
    await axios.get(API_URL, { timeout: 3000 })
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      core.error(
        'Subscription is not valid. Reach out to support@stepsecurity.io'
      )
      process.exit(1)
    } else {
      core.info('Timeout or API not reachable. Continuing to next step.')
    }
  }
}

/**
 * Get the executable extension based on the OS.
 *
 * @returns The executable extension for the current OS.
 */
function getExecutableExtension(): string {
  return getRunnerOS() === 'windows' ? '.exe' : ''
}

/**
 * Get the architecture of the runner.
 *
 * @returns The architecture of the runner.
 */
function getRunnerArch(): string {
  const runnerArch = process.env['RUNNER_ARCH']! as string
  if (runnerArch.startsWith('X')) {
    return 'amd64'
  }

  return runnerArch
}

/**
 * Get the OS of the runner.
 *
 * @returns The OS of the runner.
 */
function getRunnerOS(): string {
  const runnerOs = process.env['RUNNER_OS']! as string
  if (runnerOs.startsWith('Win')) {
    return 'windows'
  } else if (runnerOs.startsWith('Linux')) {
    return 'linux'
  } else if (runnerOs.startsWith('macOS')) {
    return 'darwin'
  }

  throw new Error(
    `Unsupported OS found. OS: ${runnerOs} Arch: ${getRunnerArch()}`
  )
}

/**
 * Get the latest version of the tool from GitHub releases.
 *
 * @param githubRepo The GitHub repository in the format 'owner/repo'.
 * @param toolName The name of the tool.
 * @param stableVersion The stable version to fall back to if the latest version cannot be retrieved.
 * @returns The latest version of the tool.
 */
async function latestVersion(
  githubRepo: string,
  toolName: string,
  stableVersion: string
): Promise<string> {
  try {
    const httpClient = new HttpClient()
    const res = await httpClient.getJson<{ tag_name: string }>(
      `https://github.com/${githubRepo}/releases/latest`
    )

    if (res.statusCode !== 200 || !res.result || !res.result.tag_name) {
      core.warning(
        `Cannot get the latest ${toolName} info from https://github.com/${githubRepo}/releases/latest. Invalid response: ${JSON.stringify(res)}. Using default version ${stableVersion}.`
      )

      return stableVersion
    }

    return res.result.tag_name.trim()
  } catch (e) {
    core.warning(
      `Cannot get the latest ${toolName} info from https://github.com/${githubRepo}/releases/latest. Error ${e}. Using default version ${stableVersion}.`
    )
  }

  return stableVersion
}

/**
 * Download the tool from GitHub releases.
 *
 * @param version The version of the tool to download.
 * @returns The path to the downloaded tool.
 */
async function download(version: string): Promise<string> {
  if (!version) {
    version = await latestVersion(githubRepository, toolName, defaultVersion)
  }

  const runnerOs = getRunnerOS()
  const runnerArch = getRunnerArch()
  const binaryFileName = toolName + getExecutableExtension()
  const url = `https://github.com/${githubRepository}/releases/download/${version}/${binaryName(version, runnerOs, runnerArch)}`

  let cachedToolPath = toolCache.find(toolName, version)
  if (cachedToolPath) {
    core.info(`Restoring '${version}' from cache`)
  } else {
    core.info(`Downloading '${version}' from '${url}'`)
    let downloadPath
    try {
      downloadPath = await toolCache.downloadTool(url)
    } catch (exception) {
      throw new Error(
        `Failed to download ${toolName} from location ${url}. Error: ${exception}`
      )
    }

    const extractedPath = await extractBinary(
      downloadPath,
      version,
      runnerOs,
      runnerArch
    )

    await fs.promises.chmod(extractedPath, 0o777)
    await toolCache.cacheFile(extractedPath, binaryFileName, toolName, version)

    cachedToolPath = toolCache.find(toolName, version)
    if (!cachedToolPath) {
      throw new Error(
        `${binaryFileName} executable not found in path ${cachedToolPath}`
      )
    }
  }

  return cachedToolPath
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    await validateSubscription()
    let version = core.getInput('version', { required: true })
    if (version.toLocaleLowerCase() === 'stable') {
      version = defaultVersion
    } else if (version.toLocaleLowerCase() === 'latest') {
      version = await latestVersion(githubRepository, toolName, defaultVersion)
    } else if (!version.toLocaleLowerCase().startsWith('v')) {
      version = 'v' + version
    }

    const cachedPath = await download(version)

    core.addPath(cachedPath)
    core.info(
      `${toolName} version: '${version}' has been cached at ${cachedPath}`
    )
    core.setOutput('path', cachedPath)

    await exec(
      cachedPath + '/' + toolName + getExecutableExtension(),
      getVersionArguments()
    )
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
