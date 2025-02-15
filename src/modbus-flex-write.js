/**
 Copyright (c) 2016,2017,2018,2019,2020,2021,2022 Klaus Landsdorf (http://node-red.plus/)
 All rights reserved.
 node-red-contrib-modbus - The BSD 3-Clause License

 @author <a href="mailto:klaus.landsdorf@bianco-royal.de">Klaus Landsdorf</a> (Bianco Royal)
 **/

/**
 * Modbus flexible Write node.
 * @module NodeRedModbusFlexWrite
 *
 * @param RED
 */
module.exports = function (RED) {
  'use strict'
  // SOURCE-MAP-REQUIRED
  const mbBasics = require('./modbus-basics')
  const mbCore = require('./core/modbus-core')
  const internalDebugLog = require('debug')('contribModbus:flex:write')

  function ModbusFlexWrite (config) {
    RED.nodes.createNode(this, config)

    this.name = config.name
    this.showStatusActivities = config.showStatusActivities
    this.showErrors = config.showErrors

    this.emptyMsgOnFail = config.emptyMsgOnFail
    this.keepMsgProperties = config.keepMsgProperties
    this.internalDebugLog = internalDebugLog
    this.verboseLogging = RED.settings.verbose

    const node = this
    node.bufferMessageList = new Map()
    mbBasics.setNodeStatusTo('waiting', node)

    const modbusClient = RED.nodes.getNode(config.server)
    if (!modbusClient) {
      return
    }
    modbusClient.registerForModbus(node)
    mbBasics.initModbusClientEvents(node, modbusClient)

    node.onModbusWriteDone = function (resp, msg) {
      if (node.showStatusActivities) {
        mbBasics.setNodeStatusTo('writing done', node)
      }

      node.send(mbCore.buildMessage(node.bufferMessageList, msg.payload, resp, msg))
      node.emit('modbusFlexWriteNodeDone')
    }

    node.errorProtocolMsg = function (err, msg) {
      if (node.showErrors) {
        mbBasics.logMsgError(node, err, msg)
      }
    }

    node.onModbusWriteError = function (err, msg) {
      node.internalDebugLog(err.message)
      const origMsg = mbCore.getOriginalMessage(node.bufferMessageList, msg)
      node.errorProtocolMsg(err, origMsg)
      mbBasics.sendEmptyMsgOnFail(node, err, msg)
      mbBasics.setModbusError(node, modbusClient, err, origMsg)
      node.emit('modbusFlexWriteNodeError')
    }

    node.prepareMsg = function (msg) {
      if (typeof msg.payload === 'string') {
        msg.payload = JSON.parse(msg.payload)
      }

      msg.payload.fc = parseInt(msg.payload.fc)
      msg.payload.unitid = parseInt(msg.payload.unitid)
      msg.payload.address = parseInt(msg.payload.address)
      msg.payload.quantity = parseInt(msg.payload.quantity)
      return msg
    }

    node.isValidModbusMsg = function (msg) {
      let isValid = true

      if (!(Number.isInteger(msg.payload.fc) &&
              (msg.payload.fc === 5 ||
                msg.payload.fc === 6 ||
                msg.payload.fc === 15 ||
                msg.payload.fc === 16))) {
        node.error('FC Not Valid', msg)
        isValid &= false
      }

      if (isValid &&
            !(Number.isInteger(msg.payload.address) &&
              msg.payload.address >= 0 &&
              msg.payload.address <= 65535)) {
        node.error('Address Not Valid', msg)
        isValid &= false
      }

      if (isValid &&
            !(Number.isInteger(msg.payload.quantity) &&
              msg.payload.quantity >= 1 &&
              msg.payload.quantity <= 65535)) {
        node.error('Quantity Not Valid', msg)
        isValid &= false
      }

      return isValid
    }

    node.setMsgPayloadFromHTTPRequests = function (msg) {
      /* HTTP requests for boolean and multiple data string [1,2,3,4,5] */
      if (Object.prototype.hasOwnProperty.call(msg.payload, 'value') && typeof msg.payload.value === 'string') {
        if (msg.payload.value === 'true' || msg.payload.value === 'false') {
          msg.payload.value = (msg.payload.value === 'true')
        } else {
          if (msg.payload.value.indexOf(',') > -1) {
            msg.payload.value = JSON.parse(msg.payload.value)
          }
        }
      }
      return msg
    }

    node.buildNewMessageObject = function (node, msg) {
      const messageId = mbCore.getObjectId()
      return {
        topic: msg.topic || node.id,
        messageId,
        payload: {
          value: (Object.prototype.hasOwnProperty.call(msg.payload, 'value')) ? msg.payload.value : msg.payload,
          unitid: msg.payload.unitid,
          fc: msg.payload.fc,
          address: msg.payload.address,
          quantity: msg.payload.quantity,
          messageId
        }
      }
    }

    node.on('input', function (msg) {
      if (mbBasics.invalidPayloadIn(msg) || !modbusClient.client) {
        return
      }

      const origMsgInput = Object.assign({}, msg)
      try {
        const inputMsg = node.prepareMsg(origMsgInput)
        if (node.isValidModbusMsg(inputMsg)) {
          const httpMsg = node.setMsgPayloadFromHTTPRequests(inputMsg)
          const newMsg = node.buildNewMessageObject(node, httpMsg)
          node.bufferMessageList.set(newMsg.messageId, mbBasics.buildNewMessage(node.keepMsgProperties, httpMsg, newMsg))
          modbusClient.emit('writeModbus', newMsg, node.onModbusWriteDone, node.onModbusWriteError)
        }
      } catch (err) {
        node.errorProtocolMsg(err, origMsgInput)
        mbBasics.sendEmptyMsgOnFail(node, err, origMsgInput)
      }

      if (node.showStatusActivities) {
        mbBasics.setNodeStatusTo(modbusClient.actualServiceState, node)
      }
    })

    node.on('close', function (done) {
      mbBasics.setNodeStatusTo('closed', node)
      node.bufferMessageList.clear()
      modbusClient.deregisterForModbus(node.id, done)
    })

    if (!node.showStatusActivities) {
      mbBasics.setNodeDefaultStatus(node)
    }
  }

  RED.nodes.registerType('modbus-flex-write', ModbusFlexWrite)
}
