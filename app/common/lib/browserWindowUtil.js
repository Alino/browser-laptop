/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let { screen, remote, nativeImage, BrowserWindow } = require('electron')
const { isDarwin, isLinux } = require('./platformUtil.js')

// work with both in-process api and inter-process api
if (!screen && remote) {
  screen = remote.screen
}

// assume Windows and macOS have 0px frame sizes
let _frameSizeOp = !isLinux() ? Promise.resolve({ left: 0, top: 0 }) : null

function calculateWindowFrameSize () {
  console.time('getWindowFrameSize')
  return new Promise(function (resolve, reject) {
    const testWindow = new BrowserWindow({
      width: 0,
      height: 0,
      minimumWidth: 0,
      minimumHeight: 0,
      center: true,
      show: false,
      frame: true
    })
    const initial = testWindow.getPosition()
    testWindow.once('show', () => {
      testWindow.once('move', () => {
        console.log('getFrameSize move', initial, testWindow.getPosition())
        const afterShown = testWindow.getPosition()
        testWindow.hide()
        console.timeEnd('getWindowFrameSize')
        testWindow.close()
        resolve({
          left: afterShown[0] - initial[0],
          top: afterShown[1] - initial[1]
        })
      })
    })
    testWindow.showInactive()
  })
}

function getWindowFrameSizeOp () {
  // do not start calculating until something has asked for the data,
  // but cache the result (only perform the calculation once)
  _frameSizeOp = _frameSizeOp || calculateWindowFrameSize()
  return _frameSizeOp
}

/**
 * Determines the screen point for a window's client point
 */
function getScreenPointAtWindowClientPoint (browserWindow, clientPoint) {
  const contentPosition = browserWindow.getContentBounds()
  const x = Math.floor(contentPosition.x + clientPoint.x)
  const y = Math.floor(contentPosition.y + clientPoint.y)
  return { x, y }
}

function getWindowClientPointAtScreenPoint (browserWindow, screenPoint) {
  const contentPosition = browserWindow.getContentBounds()
  return {
    x: screenPoint.x - contentPosition.x,
    y: screenPoint.y - contentPosition.y
  }
}

function getWindowClientSize (browserWindow) {
  const [width, height] = browserWindow.getContentSize()
  return {
    width,
    height
  }
}

/**
 * Gets the window's client position of the mouse cursor
 */
function getWindowClientPointAtCursor (browserWindow) {
  return getWindowClientPointAtScreenPoint(browserWindow, screen.getCursorScreenPoint())
}

/**
 * Determines where a window should be positioned
 * given the requirement that a client position is
 * at a given screen position
 *
 * @param {*} screenPoint - the screen position
 * @param {*} clientPoint - the client position
 */
async function getWindowPositionForClientPointAtScreenPoint (screenPoint, clientPoint) {
  const frameSize = await getWindowFrameSizeOp()
  console.log('frameSize', frameSize)
  const x = Math.floor(screenPoint.x - clientPoint.x - frameSize.left)
  const y = Math.floor(screenPoint.y - clientPoint.y - frameSize.top)
  return { x, y }
}

/**
 * Determines where a window should be positioned
 * given the requirement that a client position is
 * at the current cursor poisition
 *
 * @param {*} clientPoint - the client position
 */
function getWindowPositionForClientPointAtCursor (clientPoint) {
  return getWindowPositionForClientPointAtScreenPoint(screen.getCursorScreenPoint(), clientPoint)
}

function moveClientPositionToMouseCursor (browserWindow, clientX, clientY, {
  cursorScreenPoint = screen.getCursorScreenPoint(),
  animate = false
} = {}) {
  return moveClientPositionToScreenPoint(browserWindow, clientX, clientY, cursorScreenPoint.x, cursorScreenPoint.y, { animate })
}

async function moveClientPositionToScreenPoint (browserWindow, clientX, clientY, screenX, screenY, { animate = false } = {}) {
  const screenPoint = await getWindowPositionForClientPointAtScreenPoint({ x: screenX, y: screenY }, { x: clientX, y: clientY })
  browserWindow.setPosition(screenPoint.x, screenPoint.y, animate)
}

function animateWindowPosition (browserWindow, { fromPoint, getDestinationPoint }) {
  // electron widow position animation is darwin-only
  if (!isDarwin()) {
    moveWindowToDestination(browserWindow, getDestinationPoint)
  }
  browserWindow.setPosition(fromPoint.x, fromPoint.y)
  // just in case
  let attempts = 190
  const checkEveryMs = 16
  const moveWindow = () => {
    attempts--
    if (attempts === 0) {
      moveWindowToDestination(browserWindow, getDestinationPoint)
      return
    }
    if (browserWindow.isVisible()) {
      const [curX, curY] = browserWindow.getPosition()
      if (curX === fromPoint.x && curY === fromPoint.y) {
        moveWindowToDestination(browserWindow, getDestinationPoint, true)
      } else {
        setTimeout(moveWindow, checkEveryMs)
      }
    }
  }
  setTimeout(moveWindow, checkEveryMs)
}

function moveWindowToDestination (browserWindow, getDestinationPoint, animate = false) {
  const toPoint = getDestinationPoint()
  browserWindow.setPosition(toPoint.x, toPoint.y, animate)
}

function isClientPointWithinWindowBounds (browserWindow, windowClientPoint) {
  const [width, height] = browserWindow.getSize()
  return windowClientPoint.x >= 0 &&
    windowClientPoint.x < width &&
    windowClientPoint.y >= 0 &&
    windowClientPoint.y < height
}

function isMouseCursorOverWindowContent (browserWindow, cursorScreenPoint = screen.getCursorScreenPoint()) {
  const windowClientPoint = getWindowClientPointAtScreenPoint(browserWindow, cursorScreenPoint)
  return isClientPointWithinWindowBounds(browserWindow, windowClientPoint)
}

// BrowserWindow ctor options which can be manually
// set after window creation
const optionsSetCompatible = new Set([
  'width',
  'height',
  'x',
  'y',
  'show',
  'fullscreen',
  'center',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'resizable',
  'movable',
  'alwaysOnTop',
  'focusable',
  'icon'
])

function canSetAllPropertiesOnExistingWindow (properties) {
  // cannot set properties we don't know about
  const anyPropertiesNotCompatible = Object.keys(properties)
    .some(optionKey =>
      !optionsSetCompatible.has(optionKey) && properties[optionKey] != null
    )
  return !anyPropertiesNotCompatible
}

function setPropertiesOnExistingWindow (browserWindow, properties) {
  // set size and position
  if (properties.x != null && properties.y != null) {
    browserWindow.setPosition(properties.x, properties.y)
  }
  if (properties.width != null && properties.height != null) {
    browserWindow.setSize(properties.width, properties.height)
  }
  if (properties.maxWidth != null && properties.maxHeight != null) {
    browserWindow.setMaximumSize(properties.maxWidth, properties.maxHeight)
  }
  if (properties.minWidth != null && properties.minHeight != null) {
    browserWindow.setMinimumSize(properties.minWidth, properties.minHeight)
  }
  if (properties.resizable != null) {
    browserWindow.setResizable(properties.resizable)
  }
  if (properties.center === true) {
    browserWindow.center()
  }
  if (properties.movable != null) {
    browserWindow.setMovable(properties.movable)
  }
  if (properties.parent != null || properties.parent === null) {
    browserWindow.setParent(properties.parent)
  }
  if (properties.icon != null) {
    let windowIcon
    if (typeof properties.icon === 'string') {
      try {
        windowIcon = nativeImage.createFromPath(properties.icon)
      } catch (e) {
        console.error('Error creating nativeImage instance from window icon path: ' + e.message)
        console.error(e)
      }
    } else { // there is no electron.nativeImage fn for detecting instanceof, so assume
      windowIcon = properties.icon
    }
    if (windowIcon) {
      browserWindow.setIcon(windowIcon)
    }
  }
  if (properties.show !== false) {
    browserWindow.show()
  }
  if (properties.fullscreen) {
    browserWindow.setFullScreen(true)
  }
  if (properties.alwaysOnTop) {
    browserWindow.setAlwaysOnTop(true)
  }
  if (properties.focusable != null) {
    browserWindow.setFocusable(properties.focusable)
  }
}

module.exports = {
  getWindowClientPointAtCursor,
  getWindowClientPointAtScreenPoint,
  moveClientPositionToMouseCursor,
  animateWindowPosition,
  getWindowPositionForClientPointAtCursor,
  getScreenPointAtWindowClientPoint,
  getWindowClientSize,
  isMouseCursorOverWindowContent,
  isClientPointWithinWindowBounds,
  canSetAllPropertiesOnExistingWindow,
  setPropertiesOnExistingWindow
}
