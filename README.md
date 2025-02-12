# NeatChat
## dev
+ create a new `.env.local` file
```
OPENAI_API_KEY=<your api key here>
# if you are not able to access openai service, use this BASE_URL
BASE_URL=https://chatgpt1.nextweb.fun/api/proxy
```
```powershell
conda create -n neatchat conda-forge::yarn==1.22.19 conda-forge::nodejs=18
conda activate neatchat
yarn cache clean
yarn config set registry 'https://mirrors.huaweicloud.com/repository/npm'
yarn install
yarn dev
```
