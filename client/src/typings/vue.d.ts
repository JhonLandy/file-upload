import Vue from 'vue'
import {AxiosInstance} from 'axios'
import {Message} from 'element-ui'
//声明补充
declare module 'vue/types/vue' {

    interface Vue { 

        $axios: AxiosInstance;

        $message: typeof Message;
        
    }
}