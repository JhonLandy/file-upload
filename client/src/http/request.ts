import axios, { AxiosInstance } from 'axios'

function Request() { 
    const request =  axios.create({
        baseURL: "/api",
    });
    request.interceptors.response.use(
        async (response) => {
            // header config这里处理就可以了，应用层只需要数据data
            const {data} = response
            // if(dat)
            return data
        }
    )
    return request
}

export default Request as () => AxiosInstance