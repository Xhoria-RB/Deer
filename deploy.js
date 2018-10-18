const octokit = require('@octokit/rest')()
const fs = require('fs')
const mime = require('mime')
const path = require('path')
const glob = require('glob-fs')({ gitignore: false })

var NightlyDeploy = {
  release: {},
  filteredAssets: [],
  config: {
    owner: null,
    repo: null,
    branch: null,
    tag: null,
    assets: [],
    dir: null,
    token: ''
  },

  // Initialize NightlyDeploy.
  init (config) {
    this.config = config

    // Makes sure of asstes that will be uploaded.
    this.filteredAssets = this.config.assets.filter(asset => {
      let assetUrl = path.join(this.config.dir, asset)
      return fs.existsSync(assetUrl)
    })
    if (this.filteredAssets.length === 0) {
      console.log('There are no assets to upload...')
      return
    }

    this.authenticate()
    this.getRelease()
  },

  // Authenticating user token.
  authenticate () {
    if (!this.config.token) {
      throw new Error('Token is not provided')
    }
    console.log('Authenticating...')
    octokit.authenticate({
      type: 'token',
      token: this.config.token
    })
  },

  // Tries to check whether release is existing or not.
  // If it exists, delete it. Otherwise create new one.
  getRelease () {
    console.log('Getting relesae info...')
    octokit.repos.getReleaseByTag({
      owner: this.config.owner,
      repo: this.config.repo,
      tag: this.config.tag
    }).then(result => {
      // Release is already created.
      console.log(this.config.tag + ' is existing, so it will be deleted')
      this.release = result.data
      this.deleteRelease(result.data.id)
    }).catch(e => {
      console.log('Unable to get release info...')
      if (e.code === 404) {
        // Create the release as it does not exist.
        this.createRelease('nightly builds', 'nightly builds')
      } else {
        throw new Error('Unhandled response for getReleaseByTag: ' + e)
      }
    })
  },

  // Deletes release with releaseId, then creates new one.
  deleteRelease (releaseId) {
    console.log('Deleting release...')
    octokit.repos.deleteRelease({
      owner: this.config.owner,
      repo: this.config.repo,
      release_id: releaseId
    }).then(result => {
      console.log('Release is deleted successfully...')
      // Use previous name and body.
      let name = this.release.name
      let body = this.release.body

      // Free release object.
      this.release = null

      this.createRelease(name, body)
    }).catch(e => {
      throw new Error('Unhandled response for deleteRelease: ' + e)
    })
  },

  // Creates release with name and body using provided configs, then it calls
  // uploadAsset.
  createRelease (name, body) {
    console.log('Creating a new release...')
    octokit.repos.createRelease({
      owner: this.config.owner,
      repo: this.config.repo,
      tag_name: this.config.tag,
      name: name,
      body: body,
      target_commitish: this.config.branch,
      draft: false,
      prerelease: true
    }).then(result => {
      console.log('Release is created successfully...')
      this.release = result.data
      this.uploadAsset(0)
    }).catch(e => {
      throw new Error('Unhandled response for createRelease: ' + e)
    })
  },

  // Uploads asset for a release if it's not already uploaded, Otherwise
  // calls deleteAsset.
  uploadAsset (assetIndex) {
    if (assetIndex >= this.filteredAssets.length) {
      console.log('Assets uploaded successfully...')
      return
    }

    let asset = this.filteredAssets[assetIndex]
    console.log('Uploading ' + asset)

    let assetUrl = path.join(this.config.dir, asset)
    octokit.repos.uploadAsset({
      url: this.release.upload_url,
      file: fs.readFileSync(assetUrl),
      contentType: mime.getType(assetUrl),
      contentLength: fs.statSync(assetUrl).size,
      name: asset
    }).then(result => {
      console.log('Uploaded successfully...')
      this.uploadAsset(assetIndex + 1)
    }).catch(function (e) {
      throw new Error('Unhandled response for uploadAsset: ' + e)
    })
  }
}

// Handles errors.
process.on('unhandledRejection', error => {
  console.log('Failed to deploy')
  console.log('unhandledRejection', error)
  process.exit(1)
})

// Uses glob to get fileNames and returns array of them.
function getAssetNames (patterns = []) {
  let result = []
  patterns.forEach(pattern => {
    result =
      result.concat(glob.readdirSync(pattern).map(file => path.basename(file)))
  })
  return result
}

const assets = [
  './dist/*.deb',
  './dist/*.rpm',
  './dist/*.zip',
  './dist/*.dmg',
  './dist/*.exe'
]

const repoSlug = process.env.TRAVIS_REPO_SLUG
if (repoSlug !== 'abahmed/Deer') {
  console.log('Deployment is only done for abahmed/Deer')
  process.exit()
}

const isPullRequest = process.env.TRAVIS_PULL_REQUEST !== 'false'
if (isPullRequest) {
  console.log('Deployment is not done for Pull Requests')
  process.exit()
}

const branch = process.env.TRAVIS_BRANCH
if (branch === 'support-CD') {
  NightlyDeploy.init({
    owner: 'abahmed',
    repo: 'Deer',
    branch: branch,
    tag: 'nightly',
    assets: getAssetNames(assets),
    dir: './dist',
    token: process.env.GH_TOKEN
  })
} else {
  console.log('No deployments for ' + branch)
  process.exit()
}
